//! BLE bootstrap for Apple's AccessorySetupKit (iOS 18+).
//!
//! The iOS app's "Set up accessory" picker discovers the Car Thing through a
//! BLE advertisement, pairs the LE link inside the picker, then bridges the
//! classic (BR/EDR) transport that carries iAP2. Three pieces make that work:
//!
//! - A connectable LE advertisement carrying the bootstrap service UUID as
//!   service data — not a service-UUID list; AccessorySetupKit and
//!   CoreBluetooth match service-data UUIDs all the same, and this is the
//!   shape the shipped iOS app was validated against — plus the device name
//!   for the picker's discovered-accessory label. The advertisement is
//!   registered while the adapter is discoverable, including an explicit
//!   pairing window with an existing LE link, or while a bonded peer needs to
//!   reconnect and no LE link is active. This lets Android discover the Car
//!   Thing from its pairing screen without retaining the legacy advertising
//!   instance during normal ANCS connections.
//! - A GATT service hosting a single encrypt-read identity characteristic.
//!   iOS reads it during setup, which forces SMP pairing on an unbonded link
//!   and later reads the full device serial to correlate the authorized BLE
//!   accessory with its ExternalAccessory connection.
//! - A classic-discoverability re-arm on every read of that characteristic:
//!   BlueZ's DiscoverableTimeout has usually lapsed by the time a user
//!   pairs, and iOS needs the BR/EDR side discoverable to complete
//!   transport bridging.
//!
//! The UUIDs and the service-data payload are pinned by the shipped iOS app
//! (`AccessorySetupService.swift` and `NSAccessorySetupBluetoothServices` in
//! its Info.plist); do not change either side without the other.

use bluer::{
    adv::{Advertisement, Feature, Type},
    gatt::local::{Application, ApplicationHandle, Characteristic, CharacteristicRead, Service},
    Adapter, AdapterEvent, AdapterProperty, Uuid,
};
use dbus::{
    arg::{PropMap, Variant},
    channel::MatchingReceiver,
    message::MatchRule,
    nonblock::{Proxy, SyncConnection},
    Path,
};
use dbus_crossroads::{Crossroads, IfaceBuilder, IfaceToken};
use futures::{FutureExt, Stream, StreamExt};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::pin::Pin;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use super::hci;

pub const ACCESSORY_SETUP_SERVICE: Uuid = Uuid::from_u128(0xc0afc129_0068_48df_a60e_d1fedffed3cd);
pub const ACCESSORY_SETUP_CHARACTERISTIC: Uuid =
    Uuid::from_u128(0xfffb2ace_8c85_4ca2_9096_77831dfc84a6);

/// Marker payload carried as advertisement service data under
/// [`ACCESSORY_SETUP_SERVICE`].
const SERVICE_DATA: &[u8] = b"NOCT";

/// Advertising interval. BlueZ's 1.28 s default is far too slow for
/// AccessorySetupKit: the picker then rarely wins a scan-response exchange
/// (no device name under the product image) and its pair → read → bridge
/// reconnect cycle times out against a mostly-silent advertiser.
const ADV_MIN_INTERVAL: Duration = Duration::from_millis(100);
const ADV_MAX_INTERVAL: Duration = Duration::from_millis(150);
const ADV_RETRY_INITIAL_DELAY: Duration = Duration::from_millis(250);
const ADV_RETRY_MAX_DELAY: Duration = Duration::from_secs(5);
const ADV_STATE_POLL_INTERVAL: Duration = Duration::from_millis(500);
const BLUEZ_DBUS_TIMEOUT: Duration = Duration::from_secs(2);
const BLUEZ_SERVICE: &str = "org.bluez";
const BLUEZ_ADVERTISING_MANAGER: &str = "org.bluez.LEAdvertisingManager1";
const BLUEZ_ADVERTISEMENT_INTERFACE: &str = "org.bluez.LEAdvertisement1";
const ADVERTISEMENT_PATH: &str = "/com/usenocturne/nocturned/accessory_setup_advertisement";

type AdapterEventStream = Pin<Box<dyn Stream<Item = AdapterEvent> + Send>>;

/// Keeps the AccessorySetupKit GATT service registered and controls the LE
/// advertisement for as long as it is held.
pub struct AccessorySetupBootstrap {
    _gatt: ApplicationHandle,
    shutdown: CancellationToken,
    advertising_task: Option<JoinHandle<()>>,
}

impl AccessorySetupBootstrap {
    pub async fn register(
        adapter: &Adapter,
        device_name: &str,
        device_serial: &str,
    ) -> anyhow::Result<Self> {
        let read_adapter = adapter.clone();
        let read_identity = device_serial.as_bytes().to_vec();
        let app = Application {
            services: vec![Service {
                uuid: ACCESSORY_SETUP_SERVICE,
                primary: true,
                characteristics: vec![Characteristic {
                    uuid: ACCESSORY_SETUP_CHARACTERISTIC,
                    read: Some(CharacteristicRead {
                        read: true,
                        encrypt_read: true,
                        fun: Box::new(move |req| {
                            let adapter = read_adapter.clone();
                            let identity = read_identity.clone();
                            async move {
                                info!(
                                    address = %req.device_address,
                                    "AccessorySetupKit pairing characteristic read"
                                );
                                rearm_classic_discovery(&adapter).await;
                                Ok(identity)
                            }
                            .boxed()
                        }),
                        ..Default::default()
                    }),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        };
        let events: AdapterEventStream = Box::pin(adapter.events().await?);
        let gatt = adapter.serve_gatt_application(app).await?;
        let publisher = AdvertisingPublisher::new(adapter)?;
        let shutdown = CancellationToken::new();
        let advertising_task = tokio::spawn(run_advertising_controller(
            adapter.clone(),
            device_name.to_string(),
            events,
            publisher,
            shutdown.clone(),
        ));

        Ok(Self {
            _gatt: gatt,
            shutdown,
            advertising_task: Some(advertising_task),
        })
    }

    pub async fn shutdown(mut self) {
        self.shutdown.cancel();
        if let Some(task) = self.advertising_task.take() {
            if let Err(e) = task.await {
                warn!(error = %e, "AccessorySetupKit advertising controller failed during shutdown");
            }
        }
    }
}

impl Drop for AccessorySetupBootstrap {
    fn drop(&mut self) {
        self.shutdown.cancel();
    }
}

fn accessory_advertisement(device_name: &str) -> Advertisement {
    Advertisement {
        advertisement_type: Type::Peripheral,
        service_data: BTreeMap::from([(ACCESSORY_SETUP_SERVICE, SERVICE_DATA.to_vec())]),
        system_includes: BTreeSet::from([Feature::TxPower]),
        local_name: Some(device_name.to_string()),
        min_interval: Some(ADV_MIN_INTERVAL),
        max_interval: Some(ADV_MAX_INTERVAL),
        ..Default::default()
    }
}

struct AdvertisingPublisher {
    connection: Arc<SyncConnection>,
    crossroads: Arc<StdMutex<Crossroads>>,
    interface: IfaceToken<Advertisement>,
    adapter_path: Path<'static>,
    connection_lost: CancellationToken,
    released: CancellationToken,
    resource_task: JoinHandle<()>,
}

impl AdvertisingPublisher {
    fn new(adapter: &Adapter) -> anyhow::Result<Self> {
        let (resource, connection) = dbus_tokio::connection::new_system_sync()?;
        let connection_lost = CancellationToken::new();
        let connection_lost_for_task = connection_lost.clone();
        let resource_task = tokio::spawn(async move {
            let e = resource.await;
            connection_lost_for_task.cancel();
            warn!(error = %e, "AccessorySetupKit advertising D-Bus connection ended");
        });

        let released = CancellationToken::new();
        let released_for_interface = released.clone();
        let mut crossroads = Crossroads::new();
        let interface = crossroads.register(
            BLUEZ_ADVERTISEMENT_INTERFACE,
            move |builder: &mut IfaceBuilder<Advertisement>| {
                builder.method("Release", (), (), move |_, _, ()| {
                    released_for_interface.cancel();
                    Ok(())
                });
                builder
                    .property("Type")
                    .emits_changed_const()
                    .get(|_, advertisement| Ok(advertisement.advertisement_type.to_string()));
                builder
                    .property("ServiceData")
                    .emits_changed_const()
                    .get(|_, advertisement| {
                        Ok(advertisement
                            .service_data
                            .iter()
                            .map(|(uuid, data)| (uuid.to_string(), Variant(data.clone())))
                            .collect::<HashMap<_, _>>())
                    });
                builder
                    .property("Includes")
                    .emits_changed_const()
                    .get(|_, advertisement| {
                        Ok(advertisement
                            .system_includes
                            .iter()
                            .map(ToString::to_string)
                            .collect::<Vec<_>>())
                    });
                builder
                    .property("LocalName")
                    .emits_changed_const()
                    .get(|_, advertisement| {
                        advertisement
                            .local_name
                            .clone()
                            .ok_or_else(|| dbus_crossroads::MethodErr::no_property("LocalName"))
                    });
                builder
                    .property("MinInterval")
                    .emits_changed_const()
                    .get(|_, advertisement| {
                        advertisement
                            .min_interval
                            .map(|interval| interval.as_millis().min(u32::MAX as u128) as u32)
                            .ok_or_else(|| dbus_crossroads::MethodErr::no_property("MinInterval"))
                    });
                builder
                    .property("MaxInterval")
                    .emits_changed_const()
                    .get(|_, advertisement| {
                        advertisement
                            .max_interval
                            .map(|interval| interval.as_millis().min(u32::MAX as u128) as u32)
                            .ok_or_else(|| dbus_crossroads::MethodErr::no_property("MaxInterval"))
                    });
            },
        );
        let crossroads = Arc::new(StdMutex::new(crossroads));
        let crossroads_for_messages = Arc::clone(&crossroads);
        connection.start_receive(
            MatchRule::new_method_call(),
            Box::new(move |message, connection| {
                match crossroads_for_messages.lock() {
                    Ok(mut crossroads) => {
                        if crossroads.handle_message(message, connection).is_err() {
                            warn!("Failed to handle AccessorySetupKit advertisement D-Bus call");
                        }
                    }
                    Err(e) => {
                        warn!(error = %e, "AccessorySetupKit advertisement D-Bus state was poisoned");
                    }
                }
                true
            }),
        );

        Ok(Self {
            connection,
            crossroads,
            interface,
            adapter_path: Path::from(format!("/org/bluez/{}", adapter.name())),
            connection_lost,
            released,
            resource_task,
        })
    }

    async fn register(&self, advertisement: Advertisement) -> anyhow::Result<()> {
        let path = Path::from(ADVERTISEMENT_PATH.to_string());
        {
            let mut crossroads = self
                .crossroads
                .lock()
                .map_err(|e| anyhow::anyhow!("advertisement D-Bus state was poisoned: {e}"))?;
            crossroads.insert(path.clone(), &[self.interface], advertisement);
        }

        let proxy = Proxy::new(
            BLUEZ_SERVICE,
            self.adapter_path.clone(),
            BLUEZ_DBUS_TIMEOUT,
            Arc::clone(&self.connection),
        );
        let result: Result<(), dbus::Error> = proxy
            .method_call(
                BLUEZ_ADVERTISING_MANAGER,
                "RegisterAdvertisement",
                (path.clone(), PropMap::new()),
            )
            .await;
        if let Err(register_error) = result {
            return match self.unregister().await {
                Ok(()) => Err(register_error.into()),
                Err(cleanup_error) => Err(anyhow::anyhow!(
                    "RegisterAdvertisement failed: {register_error}; exact-path cleanup also failed: {cleanup_error}"
                )),
            };
        }
        Ok(())
    }

    async fn unregister(&self) -> anyhow::Result<()> {
        let path = Path::from(ADVERTISEMENT_PATH.to_string());
        let proxy = Proxy::new(
            BLUEZ_SERVICE,
            self.adapter_path.clone(),
            BLUEZ_DBUS_TIMEOUT,
            Arc::clone(&self.connection),
        );
        let result: Result<(), dbus::Error> = proxy
            .method_call(
                BLUEZ_ADVERTISING_MANAGER,
                "UnregisterAdvertisement",
                (path.clone(),),
            )
            .await;
        match result {
            Ok(()) => self.remove_object(&path),
            Err(e) if advertisement_is_absent(&e) => self.remove_object(&path),
            Err(e) => Err(e.into()),
        }
    }

    fn remove_object(&self, path: &Path<'static>) -> anyhow::Result<()> {
        let mut crossroads = self
            .crossroads
            .lock()
            .map_err(|e| anyhow::anyhow!("advertisement D-Bus state was poisoned: {e}"))?;
        let _: Option<Advertisement> = crossroads.remove(path);
        Ok(())
    }

    fn connection_lost(&self) -> &CancellationToken {
        &self.connection_lost
    }

    fn released(&self) -> &CancellationToken {
        &self.released
    }
}

impl Drop for AdvertisingPublisher {
    fn drop(&mut self) {
        self.resource_task.abort();
    }
}

fn advertisement_is_absent(error: &dbus::Error) -> bool {
    matches!(
        error.name(),
        Some("org.bluez.Error.DoesNotExist") | Some("org.freedesktop.DBus.Error.UnknownObject")
    )
}

async fn stop_advertising(publisher: &AdvertisingPublisher, reason: &'static str) -> bool {
    if publisher.connection_lost().is_cancelled() {
        info!(
            reason,
            "AccessorySetupKit BLE advertising stopped with its D-Bus connection"
        );
        return true;
    }
    match publisher.unregister().await {
        Ok(()) => {
            info!(reason, "AccessorySetupKit BLE advertising stopped");
            true
        }
        Err(e) => {
            warn!(
                error = %e,
                "Failed to confirm AccessorySetupKit BLE advertisement removal; closing its owner connection"
            );
            false
        }
    }
}

async fn recover_publisher(
    adapter: &Adapter,
    shutdown: &CancellationToken,
) -> Option<AdvertisingPublisher> {
    let mut retry_delay = ADV_RETRY_INITIAL_DELAY;
    loop {
        match AdvertisingPublisher::new(adapter) {
            Ok(publisher) => return Some(publisher),
            Err(e) => {
                warn!(
                    error = %e,
                    retry_after = ?retry_delay,
                    "Failed to recreate AccessorySetupKit advertising D-Bus connection"
                );
            }
        }
        let delay = retry_delay;
        retry_delay = retry_delay.saturating_mul(2).min(ADV_RETRY_MAX_DELAY);
        tokio::select! {
            _ = shutdown.cancelled() => return None,
            _ = tokio::time::sleep(delay) => {}
        }
    }
}

async fn replace_publisher(
    publisher: &mut Option<AdvertisingPublisher>,
    adapter: &Adapter,
    shutdown: &CancellationToken,
) -> bool {
    drop(publisher.take());
    let Some(replacement) = recover_publisher(adapter, shutdown).await else {
        return false;
    };
    *publisher = Some(replacement);
    true
}

async fn stop_with_fail_closed_owner(
    publisher: &mut Option<AdvertisingPublisher>,
    adapter: &Adapter,
    shutdown: &CancellationToken,
    reason: &'static str,
) -> bool {
    let Some(active_publisher) = publisher.as_ref() else {
        return true;
    };
    if stop_advertising(active_publisher, reason).await {
        return true;
    }
    replace_publisher(publisher, adapter, shutdown).await
}

async fn run_advertising_controller(
    adapter: Adapter,
    device_name: String,
    mut events: AdapterEventStream,
    publisher: AdvertisingPublisher,
    shutdown: CancellationToken,
) {
    // The event stream was subscribed before this task started. Each relevant
    // event triggers a fresh property read so queued events cannot apply a
    // stale value after a rapid discoverability toggle.
    let mut publisher = Some(publisher);
    let mut advertising = false;
    let mut retry_delay = ADV_RETRY_INITIAL_DELAY;

    loop {
        if shutdown.is_cancelled() {
            if advertising {
                if let Some(active_publisher) = publisher.as_ref() {
                    if !stop_advertising(active_publisher, "daemon shutdown").await {
                        drop(publisher.take());
                    }
                }
            }
            return;
        }

        let retry = match advertising_required(&adapter).await {
            Ok(true) if !advertising => {
                let register_result = match publisher.as_ref() {
                    Some(active_publisher) => {
                        active_publisher
                            .register(accessory_advertisement(&device_name))
                            .await
                    }
                    None => return,
                };
                match register_result {
                    Ok(()) => match advertising_required(&adapter).await {
                        Ok(true) => {
                            advertising = true;
                            retry_delay = ADV_RETRY_INITIAL_DELAY;
                            info!(
                                service_uuid = %ACCESSORY_SETUP_SERVICE,
                                "AccessorySetupKit BLE advertising started for pairing or bonded-peer reconnect"
                            );
                            false
                        }
                        Ok(false) => {
                            if !stop_with_fail_closed_owner(
                                &mut publisher,
                                &adapter,
                                &shutdown,
                                "Bluetooth no longer requires pairing or bonded-peer reconnect advertising",
                            )
                            .await
                            {
                                return;
                            }
                            false
                        }
                        Err(e) => {
                            if !stop_with_fail_closed_owner(
                                &mut publisher,
                                &adapter,
                                &shutdown,
                                "advertising eligibility could not be confirmed after registration",
                            )
                            .await
                            {
                                return;
                            }
                            warn!(
                                error = %e,
                                retry_after = ?retry_delay,
                                "AccessorySetupKit BLE advertising registration cancelled because eligibility could not be confirmed"
                            );
                            true
                        }
                    },
                    Err(e) => {
                        warn!(
                            error = %e,
                            retry_after = ?retry_delay,
                            "Failed to start AccessorySetupKit BLE advertising"
                        );
                        if !replace_publisher(&mut publisher, &adapter, &shutdown).await {
                            return;
                        }
                        true
                    }
                }
            }
            Ok(true) => false,
            Ok(false) => {
                if advertising {
                    if !stop_with_fail_closed_owner(
                        &mut publisher,
                        &adapter,
                        &shutdown,
                        "Bluetooth does not require pairing or reconnect advertising",
                    )
                    .await
                    {
                        return;
                    }
                    advertising = false;
                }
                retry_delay = ADV_RETRY_INITIAL_DELAY;
                false
            }
            Err(e) => {
                if advertising {
                    if !stop_with_fail_closed_owner(
                        &mut publisher,
                        &adapter,
                        &shutdown,
                        "advertising eligibility could not be read",
                    )
                    .await
                    {
                        return;
                    }
                    advertising = false;
                }
                warn!(
                    error = %e,
                    retry_after = ?retry_delay,
                    "Failed to determine AccessorySetupKit advertising eligibility"
                );
                true
            }
        };

        let Some(connection_lost) = publisher
            .as_ref()
            .map(|active_publisher| active_publisher.connection_lost().clone())
        else {
            return;
        };
        let Some(released) = publisher
            .as_ref()
            .map(|active_publisher| active_publisher.released().clone())
        else {
            return;
        };

        let wait_for_state_change = async {
            loop {
                match events.next().await {
                    Some(AdapterEvent::PropertyChanged(AdapterProperty::Discoverable(_)))
                    | Some(AdapterEvent::PropertyChanged(AdapterProperty::Powered(_)))
                    | Some(AdapterEvent::DeviceAdded(_))
                    | Some(AdapterEvent::DeviceRemoved(_)) => {
                        return true;
                    }
                    Some(_) => {}
                    None => return false,
                }
            }
        };

        let (events_alive, publisher_lost, publisher_released) = if retry {
            let delay = retry_delay;
            retry_delay = retry_delay.saturating_mul(2).min(ADV_RETRY_MAX_DELAY);
            tokio::select! {
                events_alive = wait_for_state_change => (events_alive, false, false),
                _ = shutdown.cancelled() => (true, false, false),
                _ = connection_lost.cancelled() => (true, true, false),
                _ = released.cancelled() => (true, false, true),
                _ = tokio::time::sleep(delay) => (true, false, false),
            }
        } else {
            tokio::select! {
                events_alive = wait_for_state_change => (events_alive, false, false),
                _ = shutdown.cancelled() => (true, false, false),
                _ = connection_lost.cancelled() => (true, true, false),
                _ = released.cancelled() => (true, false, true),
                _ = tokio::time::sleep(ADV_STATE_POLL_INTERVAL) => (true, false, false),
            }
        };

        if publisher_lost || publisher_released {
            advertising = false;
            if publisher_lost {
                warn!("AccessorySetupKit advertising D-Bus connection was lost; recreating it");
            } else {
                info!("BlueZ released the AccessorySetupKit advertisement; recreating it");
            }
            if !replace_publisher(&mut publisher, &adapter, &shutdown).await {
                return;
            }
            retry_delay = ADV_RETRY_INITIAL_DELAY;
            continue;
        }

        if !events_alive {
            if advertising {
                if !stop_with_fail_closed_owner(
                    &mut publisher,
                    &adapter,
                    &shutdown,
                    "adapter event stream ended",
                )
                .await
                {
                    return;
                }
                advertising = false;
            }
            warn!("AccessorySetupKit adapter event stream ended; resubscribing");

            loop {
                if shutdown.is_cancelled() {
                    return;
                }
                match adapter.events().await {
                    Ok(new_events) => {
                        events = Box::pin(new_events);
                        retry_delay = ADV_RETRY_INITIAL_DELAY;
                        break;
                    }
                    Err(e) => {
                        warn!(
                            error = %e,
                            retry_after = ?retry_delay,
                            "Failed to resubscribe to AccessorySetupKit adapter events"
                        );
                        let delay = retry_delay;
                        retry_delay = retry_delay.saturating_mul(2).min(ADV_RETRY_MAX_DELAY);
                        tokio::select! {
                            _ = shutdown.cancelled() => return,
                            _ = tokio::time::sleep(delay) => {}
                        }
                    }
                }
            }
        }
    }
}

async fn advertising_required(adapter: &Adapter) -> anyhow::Result<bool> {
    let powered = adapter.is_powered().await?;
    let le_acl_active = powered && hci::any_le_acl_connected(adapter)?;
    let discoverable = powered && adapter.is_discoverable().await?;
    let mut has_bonded_peer = false;
    if powered && !le_acl_active && !discoverable {
        for address in adapter.device_addresses().await? {
            let device = adapter.device(address)?;
            if device.is_paired().await.unwrap_or(false) {
                has_bonded_peer = true;
                break;
            }
        }
    }
    Ok(should_advertise(
        powered,
        discoverable,
        has_bonded_peer,
        le_acl_active,
    ))
}

fn should_advertise(
    powered: bool,
    discoverable: bool,
    has_bonded_peer: bool,
    le_acl_active: bool,
) -> bool {
    powered && (discoverable || (!le_acl_active && has_bonded_peer))
}

/// iOS pages and inquiry-scans the BR/EDR side right after the LE pairing it
/// performs in the accessory picker; BlueZ's DiscoverableTimeout has usually
/// expired by then, so flip discoverable back on for the bridging window.
async fn rearm_classic_discovery(adapter: &Adapter) {
    match adapter.set_discoverable(true).await {
        Ok(()) => {
            info!("Classic Bluetooth discovery re-armed for AccessorySetupKit transport setup")
        }
        Err(e) => {
            warn!(
                error = %e,
                "Failed to re-arm Classic Bluetooth discovery after AccessorySetupKit pairing"
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advertisement_preserves_picker_contract_without_overriding_adapter_state() {
        let advertisement = accessory_advertisement("Nocturne (Q01S)");

        assert_eq!(advertisement.advertisement_type, Type::Peripheral);
        assert_eq!(
            advertisement.service_data.get(&ACCESSORY_SETUP_SERVICE),
            Some(&SERVICE_DATA.to_vec())
        );
        assert_eq!(advertisement.discoverable, None);
        assert_eq!(advertisement.local_name.as_deref(), Some("Nocturne (Q01S)"));
        assert_eq!(advertisement.min_interval, Some(ADV_MIN_INTERVAL));
        assert_eq!(advertisement.max_interval, Some(ADV_MAX_INTERVAL));
        assert!(advertisement.system_includes.contains(&Feature::TxPower));
    }

    #[test]
    fn advertising_eligibility_preserves_explicit_pairing_during_le_connections() {
        assert!(!should_advertise(false, true, true, false));
        assert!(should_advertise(true, true, false, false));
        assert!(should_advertise(true, false, true, false));
        assert!(!should_advertise(true, false, false, false));
        assert!(!should_advertise(true, false, true, true));
        assert!(should_advertise(true, true, false, true));
        assert!(should_advertise(true, true, true, true));
    }

    #[tokio::test]
    #[ignore = "requires a Linux host with BlueZ LE advertising support"]
    async fn publisher_serializes_rapid_register_unregister_cycles() {
        let session = bluer::Session::new().await.unwrap();
        let adapter = session.default_adapter().await.unwrap();
        let baseline_instances = adapter.active_advertising_instances().await.unwrap();
        let publisher = AdvertisingPublisher::new(&adapter).unwrap();

        for _ in 0..20 {
            publisher
                .register(accessory_advertisement("Nocturne Test"))
                .await
                .unwrap();
            assert_eq!(
                adapter.active_advertising_instances().await.unwrap(),
                baseline_instances + 1
            );
            publisher.unregister().await.unwrap();
            assert_eq!(
                adapter.active_advertising_instances().await.unwrap(),
                baseline_instances
            );
        }
    }
}
