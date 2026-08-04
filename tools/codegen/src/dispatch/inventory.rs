//! Walks `crates/lib/src/` and builds an `Inventory` of wire-protocol
//! structural pieces across both transports:
//!
//! - **Gateway** (Bluetooth, msgpack+gzip): `BridgeToGatewayMsgData` /
//!   `GatewayToBridgeMsgData`.
//! - **Client** (local WebSocket, JSON): `BridgeToClientMsgData` /
//!   `ClientToBridgeMsgData`.
//!
//! Discovers top-level enums, inner enums, marker trait impls (inferred
//! from `#[derive(BridgeEnum)]` per-variant tags + parent ident's
//! direction prefix, plus standalone `#[derive(WireEvent/...)]` derives
//! keyed off `#[wire(<Direction>, ...)]`), and typed-request declarations
//! (`#[derive(WireRequest)]` keyed off `#[wire_request(...)]`).
//!
//! The plan layer groups results by `Protocol` and emits per-protocol
//! per-language helper files.

use std::collections::{BTreeSet, HashMap};

use anyhow::{Context, Result};
use syn::{
    Attribute, Fields, GenericArgument, Item, ItemEnum, ItemStruct, Meta, PathArguments, Type,
    Variant,
};

use super::casing::snake_to_camel;

pub const BRIDGE_TO_GATEWAY: &str = "BridgeToGatewayMsgData";
pub const GATEWAY_TO_BRIDGE: &str = "GatewayToBridgeMsgData";
pub const BRIDGE_TO_CLIENT: &str = "BridgeToClientMsgData";
pub const CLIENT_TO_BRIDGE: &str = "ClientToBridgeMsgData";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Family {
    Bluetooth,
    Device,
    Audio,
    MediaControl,
    Phone,
    Spotify,
    Voice,
    BtOnly,
    Ota, // OTA was first; keep as a family for cohesion
    Iap2,
}

/// Canonical field-level shape used by the non-OTA wire inventory.
///
/// The daemon and current consumers still mix snake_case, camelCase, and
/// iAP2/MediaRemote PascalCase. `Field::name` is the selected canonical
/// snake_case spelling; `Field::source` records the current wire spelling
/// when it differs so the W-track migrations have an explicit drift list.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FieldKind {
    Bool,
    U8,
    U16,
    U32,
    U64,
    I64,
    F64,
    String,
    StringArray,
    NumberArray,
    Object,
    ObjectArray,
    Json,
    BytesBase64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Field {
    pub name: &'static str,
    pub source: &'static str,
    pub kind: FieldKind,
    pub required: bool,
    pub doc: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Payload {
    pub fields: &'static [Field],
    pub example: &'static str,
    pub doc: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Method {
    pub name: &'static str,
    pub family: Family,
    /// Current daemon/consumer spelling. Equals `name` when already canonical.
    pub source: &'static str,
    /// Additional legacy spellings accepted by the current daemon.
    pub aliases: &'static [&'static str],
    pub request: Payload,
    pub response: Payload,
    pub doc: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Event {
    pub name: &'static str,
    pub family: Family,
    /// Current daemon/consumer spelling. Equals `name` when already canonical.
    pub source: &'static str,
    pub aliases: &'static [&'static str],
    pub payload: Payload,
    pub iap2_csm: Option<&'static str>,
    pub doc: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct CsmMessageId(pub u16);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CsmDirection {
    SentByAccessory,
    ReceivedByAccessory,
    Bidirectional,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CsmFieldKind {
    Bool,
    U8,
    I8,
    U16,
    I16,
    U32,
    I32,
    U64,
    I64,
    String,
    Bytes,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct CsmField {
    pub name: &'static str,
    pub param_id: u16,
    pub kind: CsmFieldKind,
    pub required: bool,
    pub doc: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Csm {
    pub name: &'static str,
    pub family: Family,
    pub msg_id: CsmMessageId,
    pub direction: CsmDirection,
    pub params: &'static [CsmField],
    pub doc: &'static str,
}

const fn f(name: &'static str, kind: FieldKind, required: bool, doc: &'static str) -> Field {
    Field {
        name,
        source: name,
        kind,
        required,
        doc,
    }
}

const fn fs(
    name: &'static str,
    source: &'static str,
    kind: FieldKind,
    required: bool,
    doc: &'static str,
) -> Field {
    Field {
        name,
        source,
        kind,
        required,
        doc,
    }
}

const fn payload(fields: &'static [Field], example: &'static str, doc: &'static str) -> Payload {
    Payload {
        fields,
        example,
        doc,
    }
}

const fn method(
    name: &'static str,
    family: Family,
    source: &'static str,
    aliases: &'static [&'static str],
    request: Payload,
    response: Payload,
    doc: &'static str,
) -> Method {
    Method {
        name,
        family,
        source,
        aliases,
        request,
        response,
        doc,
    }
}

const fn event(
    name: &'static str,
    family: Family,
    source: &'static str,
    aliases: &'static [&'static str],
    payload: Payload,
    doc: &'static str,
) -> Event {
    Event {
        name,
        family,
        source,
        aliases,
        payload,
        iap2_csm: None,
        doc,
    }
}

pub const fn event_with_iap2_csm(
    name: &'static str,
    family: Family,
    source: &'static str,
    aliases: &'static [&'static str],
    payload: Payload,
    iap2_csm: &'static str,
    doc: &'static str,
) -> Event {
    Event {
        name,
        family,
        source,
        aliases,
        payload,
        iap2_csm: Some(iap2_csm),
        doc,
    }
}

const fn csm_param(
    name: &'static str,
    param_id: u16,
    kind: CsmFieldKind,
    required: bool,
    doc: &'static str,
) -> CsmField {
    CsmField {
        name,
        param_id,
        kind,
        required,
        doc,
    }
}

const fn csm(
    name: &'static str,
    msg_id: u16,
    direction: CsmDirection,
    params: &'static [CsmField],
    doc: &'static str,
) -> Csm {
    Csm {
        name,
        family: Family::Iap2,
        msg_id: CsmMessageId(msg_id),
        direction,
        params,
        doc,
    }
}

pub const EMPTY_PAYLOAD: Payload = payload(&[], "{}", "No payload.");
pub const OPAQUE_JSON_PAYLOAD: Payload = payload(
    &[],
    "{}",
    "Opaque JSON payload owned by the companion app or legacy daemon code.",
);
pub const STATUS_OK_RESPONSE: Payload = payload(
    &[f(
        "status",
        FieldKind::String,
        true,
        "Operation status string.",
    )],
    r#"{"status":"ok"}"#,
    "Simple status response.",
);
pub const SUCCESS_RESPONSE: Payload = payload(
    &[
        f(
            "success",
            FieldKind::Bool,
            true,
            "Whether the command succeeded.",
        ),
        f(
            "error",
            FieldKind::String,
            false,
            "Error text when success is false.",
        ),
    ],
    r#"{"success":true}"#,
    "Boolean success response used by daemon-admin methods.",
);
pub const BRIGHTNESS_RESPONSE: Payload = payload(
    &[
        f(
            "auto",
            FieldKind::Bool,
            true,
            "Whether automatic brightness is enabled.",
        ),
        f(
            "brightness",
            FieldKind::U8,
            true,
            "Backlight value, inverted Car Thing scale 0..160.",
        ),
    ],
    r#"{"auto":true,"brightness":113}"#,
    "Brightness configuration response.",
);
pub const DISPLAY_STATE_RESPONSE: Payload = payload(
    &[
        f(
            "auto",
            FieldKind::Bool,
            true,
            "Whether automatic brightness is enabled.",
        ),
        f(
            "brightness",
            FieldKind::U8,
            true,
            "Saved backlight value, inverted Car Thing scale 0..160.",
        ),
        f(
            "sleeping",
            FieldKind::Bool,
            true,
            "Whether the display backlight is sleeping.",
        ),
    ],
    r#"{"auto":true,"brightness":113,"sleeping":false}"#,
    "Display sleep state response.",
);

/// Wire-direction tag - one per recognized parent-ident prefix.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Direction {
    BridgeToGateway,
    GatewayToBridge,
    BridgeToClient,
    ClientToBridge,
}

impl Direction {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "BridgeToGateway" => Some(Self::BridgeToGateway),
            "GatewayToBridge" => Some(Self::GatewayToBridge),
            "BridgeToClient" => Some(Self::BridgeToClient),
            "ClientToBridge" => Some(Self::ClientToBridge),
            _ => None,
        }
    }

    pub fn from_parent_ident(ident: &str) -> Option<Self> {
        if ident.starts_with("BridgeToGateway") {
            Some(Self::BridgeToGateway)
        } else if ident.starts_with("GatewayToBridge") {
            Some(Self::GatewayToBridge)
        } else if ident.starts_with("BridgeToClient") {
            Some(Self::BridgeToClient)
        } else if ident.starts_with("ClientToBridge") {
            Some(Self::ClientToBridge)
        } else {
            None
        }
    }

    pub fn wire_data_name(self) -> &'static str {
        match self {
            Self::BridgeToGateway => BRIDGE_TO_GATEWAY,
            Self::GatewayToBridge => GATEWAY_TO_BRIDGE,
            Self::BridgeToClient => BRIDGE_TO_CLIENT,
            Self::ClientToBridge => CLIENT_TO_BRIDGE,
        }
    }

    /// Opposite direction in the same protocol family. Used for typed
    /// requests where the response arrives on the opposite-direction
    /// wire.
    pub fn opposite(self) -> Self {
        match self {
            Self::BridgeToGateway => Self::GatewayToBridge,
            Self::GatewayToBridge => Self::BridgeToGateway,
            Self::BridgeToClient => Self::ClientToBridge,
            Self::ClientToBridge => Self::BridgeToClient,
        }
    }
}

impl std::str::FromStr for Direction {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::parse(s).ok_or(())
    }
}

/// Coarse-grained protocol family. Each protocol owns one pair of
/// `Direction`s.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Protocol {
    Gateway,
    Client,
}

impl Protocol {
    pub fn of(direction: Direction) -> Self {
        match direction {
            Direction::BridgeToGateway | Direction::GatewayToBridge => Self::Gateway,
            Direction::BridgeToClient | Direction::ClientToBridge => Self::Client,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MarkerKind {
    Event,
    Command,
    Unicast,
}

#[derive(Debug, Clone)]
pub struct WireVariant {
    pub name: String,
    /// Single-field tuple-variant payload. `None` for unit variants AND
    /// for struct-shaped variants - the latter are exposed only at the
    /// parent enum level because per-language type-paths to them differ
    /// enough that codegen for the inner field set isn't worth the
    /// surface.
    pub payload: Option<PayloadType>,
    /// True for `Foo { ... }` named-field variants. Outbound codegen
    /// skips these because constructing the variant requires per-field
    /// args and per-language struct shapes that the dispatch layer
    /// doesn't model.
    pub is_struct: bool,
    /// Per-variant `#[bridge_*]` tag. Lets codegen pick the right wire
    /// `meta.kind` per variant inside an inner enum that mixes events
    /// with commands. `None` for outer wire enums (no per-variant tag).
    pub tag: Option<VariantTag>,
}

/// Per-variant tag inferred from `#[bridge_event]` / `#[bridge_command]`
/// / `#[bridge_request]` / `#[bridge_response]` attributes on inner
/// enum variants. Drives per-variant outbound `meta.kind` selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VariantTag {
    Event,
    Command,
    Request,
    Response,
}

/// Semantic categorization of a single-tuple variant payload.
/// Per-language emitters translate these to their native types.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PayloadType {
    /// Named user type (struct or enum). Carries the bare ident
    /// (last path segment).
    Named(String),
    /// `Vec<u8>` - translates to per-language bytes type.
    Bytes,
    /// `serde_json::Value` - translates to per-language unstructured-json type.
    JsonValue,
    /// Plain `String`.
    StringScalar,
}

impl PayloadType {
    pub fn ts(&self) -> String {
        match self {
            Self::Named(n) => n.clone(),
            Self::Bytes => "Uint8Array".to_string(),
            Self::JsonValue => "unknown".to_string(),
            Self::StringScalar => "string".to_string(),
        }
    }
    pub fn kotlin(&self) -> String {
        match self {
            Self::Named(n) => n.clone(),
            Self::Bytes => "ByteArray".to_string(),
            Self::JsonValue => "Value".to_string(),
            Self::StringScalar => "String".to_string(),
        }
    }
    pub fn swift(&self) -> String {
        match self {
            Self::Named(n) => match n.as_str() {
                // Disambiguate from Foundation.Notification.
                "Notification" => "BridgethingSchema.Notification".to_string(),
                _ => n.clone(),
            },
            Self::Bytes => "Data".to_string(),
            Self::JsonValue => "Value".to_string(),
            Self::StringScalar => "String".to_string(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct EnumDef {
    pub name: String,
    pub variants: Vec<WireVariant>,
    /// Adjacent-tagged discriminator field name (e.g. `"event"` for most
    /// inner enums, `"encoding"` for `ForwardMessage`, `"type"` for the
    /// outer wire enums). Defaults to `"type"` if the enum isn't tagged.
    pub tag_field: String,
}

/// Markers attached to one named type, with the wire direction each
/// marker applies to. A type may carry multiple markers across multiple
/// directions (e.g. `ForwardMessage` is `WireEvent<W>` for three wires).
#[derive(Debug, Clone, Default)]
pub struct MarkerSet {
    pub entries: Vec<(MarkerKind, Direction)>,
}

impl MarkerSet {
    pub fn has(&self, kind: MarkerKind, direction: Direction) -> bool {
        self.entries
            .iter()
            .any(|(k, d)| *k == kind && *d == direction)
    }
}

#[derive(Debug)]
pub struct Inventory {
    pub wire_enums: HashMap<String, EnumDef>,
    pub enums: HashMap<String, EnumDef>,
    pub markers: HashMap<String, MarkerSet>,
    pub typed_requests: Vec<TypedRequest>,
    pub methods: &'static [Method],
    pub events: &'static [Event],
    pub csms: &'static [Csm],
    /// camelCase names of every struct field whose Rust type is `Uuid`.
    /// Per-language codecs use this to bridge the on-wire representation
    /// (msgpack 16-byte `bin` on the gateway, JSON hyphenated string on
    /// the local websocket) and the SDK-surface UUID type.
    pub uuid_field_names: BTreeSet<String>,
}

/// A single typed-request declaration, captured in structured form.
/// Codegen reads these to emit typed query methods and typed-handle
/// inbound dispatch in each per-language SDK.
#[derive(Debug, Clone)]
pub struct TypedRequest {
    pub request: String,
    /// Outbound direction: the direction the request enters. Response
    /// arrives on `direction.opposite()`.
    pub direction: Direction,
    pub surface: String,
    pub request_variant: String,
    pub request_takes_payload: bool,
    pub response: String,
    pub response_variant: String,
    pub error: Option<String>,
    pub error_variant: Option<String>,
}

pub const METHOD_INVENTORY: &[Method] = &[
    method(
        "bluetooth.devices.list",
        Family::Bluetooth,
        "bluetooth.devices.list",
        &[],
        EMPTY_PAYLOAD,
        payload(
            &[
                f(
                    "payload",
                    FieldKind::ObjectArray,
                    true,
                    "Paired BlueZ devices. device_info carries name/icon/class; computer-class peers are additionally annotated with device_type/connection_type macos_connector and channel 3 so the UI can echo them back on bluetooth.device.connect.",
                ),
                f(
                    "type",
                    FieldKind::String,
                    true,
                    "Legacy discriminator; currently bluetooth_device_list.",
                ),
            ],
            r#"{"payload":[{"address":"AA:BB:CC:DD:EE:FF","blocked":false,"default":true,"connected":true,"device_info":{"name":"iPhone","icon":"phone","class":5898764}},{"address":"11:22:33:44:55:66","blocked":false,"default":false,"connected":false,"device_info":{"name":"MacBook Pro","icon":"computer","class":2360580},"device_type":"macos_connector","connection_type":"macos_connector","channel":3}],"type":"bluetooth_device_list"}"#,
            "List paired Bluetooth devices.",
        ),
        "Enumerates paired BlueZ devices for the UI.",
    ),
    method(
        "bluetooth.device.connect",
        Family::Bluetooth,
        "bluetooth.device.connect",
        &[],
        payload(
            &[
                f(
                    "address",
                    FieldKind::String,
                    true,
                    "BlueZ device MAC address.",
                ),
                f(
                    "channel",
                    FieldKind::U8,
                    false,
                    "Optional RFCOMM channel hint; 3 forces the macOS connector probe, otherwise the daemon auto-detects.",
                ),
                f(
                    "device_type",
                    FieldKind::String,
                    false,
                    "Optional peer type hint; computer/mac/macos/macos_connector force the macOS connector probe.",
                ),
            ],
            r#"{"address":"AA:BB:CC:DD:EE:FF"}"#,
            "Connect to a paired device.",
        ),
        payload(
            &[
                f(
                    "status",
                    FieldKind::String,
                    true,
                    "connected, waiting_for_ios, waiting_for_macos_connector, or waiting_for_android.",
                ),
                f("device", FieldKind::String, true, "Device address."),
            ],
            r#"{"status":"connected","device":"AA:BB:CC:DD:EE:FF"}"#,
            "Connection result.",
        ),
        "Connects via iAP2 when available, otherwise arms Android SPP wake.",
    ),
    method(
        "bluetooth.device.disconnect",
        Family::Bluetooth,
        "bluetooth.device.disconnect",
        &[],
        payload(
            &[f(
                "address",
                FieldKind::String,
                true,
                "BlueZ device MAC address.",
            )],
            r#"{"address":"AA:BB:CC:DD:EE:FF"}"#,
            "Disconnect a device.",
        ),
        payload(
            &[
                f("status", FieldKind::String, true, "disconnected."),
                f("device", FieldKind::String, true, "Device address."),
            ],
            r#"{"status":"disconnected","device":"AA:BB:CC:DD:EE:FF"}"#,
            "Disconnect result.",
        ),
        "Disconnects a currently connected Bluetooth device.",
    ),
    method(
        "bluetooth.device.unpair",
        Family::Bluetooth,
        "bluetooth.device.unpair",
        &["bluetooth.device.forget"],
        payload(
            &[f(
                "address",
                FieldKind::String,
                true,
                "BlueZ device MAC address.",
            )],
            r#"{"address":"AA:BB:CC:DD:EE:FF"}"#,
            "Remove a paired device.",
        ),
        payload(
            &[
                f("status", FieldKind::String, true, "unpaired."),
                f("device", FieldKind::String, true, "Device address."),
            ],
            r#"{"status":"unpaired","device":"AA:BB:CC:DD:EE:FF"}"#,
            "Unpair result.",
        ),
        "Removes a device from BlueZ. The daemon also accepts bluetooth.device.forget as a legacy alias.",
    ),
    method(
        "bluetooth.discoverable",
        Family::Bluetooth,
        "bluetooth.discoverable",
        &[],
        payload(
            &[f(
                "discoverable",
                FieldKind::Bool,
                true,
                "Whether to request discoverable mode.",
            )],
            r#"{"discoverable":true}"#,
            "Set adapter discoverability.",
        ),
        payload(
            &[
                f(
                    "discoverable",
                    FieldKind::Bool,
                    true,
                    "Requested discoverable state.",
                ),
                f("status", FieldKind::String, true, "requested."),
            ],
            r#"{"discoverable":true,"status":"requested"}"#,
            "Discoverability request result.",
        ),
        "Toggles BlueZ discoverable mode and broadcasts bluetooth.discoverable.",
    ),
    method(
        "device.version",
        Family::Device,
        "device.version",
        &[],
        EMPTY_PAYLOAD,
        payload(
            &[
                f(
                    "version",
                    FieldKind::String,
                    false,
                    "Full firmware version.",
                ),
                fs(
                    "short_version",
                    "shortVersion",
                    FieldKind::String,
                    false,
                    "Short firmware version.",
                ),
                fs(
                    "image_version",
                    "imageVersion",
                    FieldKind::String,
                    false,
                    "Exact version baked into the running rootfs image.",
                ),
                fs(
                    "bandaid_version",
                    "bandaidVersion",
                    FieldKind::String,
                    false,
                    "Version of the active daemon and webapp overlay, falling back to the rootfs image version.",
                ),
                fs(
                    "git_hash",
                    "gitHash",
                    FieldKind::String,
                    false,
                    "Build git hash.",
                ),
                fs(
                    "build_date",
                    "buildDate",
                    FieldKind::String,
                    false,
                    "Build date.",
                ),
                f("error", FieldKind::String, false, "Read/parse error."),
            ],
            r#"{"version":"4.1.1+20260727010101","short_version":"4.1.1+20260727010101","image_version":"4.1.0+20260726010101","bandaid_version":"4.1.1+20260727010101","build_date":"2026-05-31T17:06:50Z"}"#,
            "Version metadata derived from /etc/superbird. Inventory canonicalizes camelCase wire fields to snake_case.",
        ),
        "Reads the firmware version metadata.",
    ),
    method(
        "device.info",
        Family::Device,
        "device.info",
        &[],
        EMPTY_PAYLOAD,
        payload(
            &[
                f("device", FieldKind::String, true, "Bluetooth display name."),
                f(
                    "version",
                    FieldKind::String,
                    true,
                    "Short firmware version.",
                ),
                fs(
                    "full_version",
                    "fullVersion",
                    FieldKind::String,
                    false,
                    "Full firmware version.",
                ),
                fs(
                    "image_version",
                    "imageVersion",
                    FieldKind::String,
                    false,
                    "Exact version baked into the running rootfs image.",
                ),
                fs(
                    "bandaid_version",
                    "bandaidVersion",
                    FieldKind::String,
                    false,
                    "Version of the active daemon and webapp overlay, falling back to the rootfs image version.",
                ),
                fs(
                    "build_date",
                    "buildDate",
                    FieldKind::String,
                    false,
                    "Build date.",
                ),
                fs(
                    "git_hash",
                    "gitHash",
                    FieldKind::String,
                    false,
                    "Build git hash.",
                ),
                fs(
                    "serial_number",
                    "serialNumber",
                    FieldKind::String,
                    false,
                    "Car Thing serial number.",
                ),
            ],
            r#"{"device":"Nocturne (1234)","version":"2.0.5+20260727010101","full_version":"2.0.5+20260727010101","image_version":"2.0.4+20260726010101","bandaid_version":"2.0.5+20260727010101","build_date":"2026-05-28","git_hash":"abc123","serial_number":"SERIAL1234"}"#,
            "Device metadata. Current daemon serializes this struct as camelCase; inventory canonicalizes fields.",
        ),
        "Returns daemon/device metadata. Also available as a BT call handler.",
    ),
    method(
        "device.launch_app",
        Family::Device,
        "device.launchApp",
        &[],
        payload(
            &[fs(
                "bundle_id",
                "bundleId",
                FieldKind::String,
                false,
                "iOS app bundle identifier; defaults to com.usenocturne.nocturne.",
            )],
            r#"{"bundle_id":"com.usenocturne.nocturne"}"#,
            "Request the phone to launch an app. Current WS field is bundleId.",
        ),
        STATUS_OK_RESPONSE,
        "Sends iAP2 RequestAppLaunch to the phone.",
    ),
    method(
        "device.timezone.get",
        Family::Device,
        "device.timezone.get",
        &[],
        EMPTY_PAYLOAD,
        payload(
            &[f(
                "timezone",
                FieldKind::Object,
                true,
                "Phone timezone object.",
            )],
            r#"{"timezone":{"identifier":"America/Los_Angeles"}}"#,
            "Phone timezone response.",
        ),
        "Forwarded to the companion app for timezone metadata.",
    ),
    method(
        "device.time.get",
        Family::Device,
        "device.time.get",
        &[],
        EMPTY_PAYLOAD,
        payload(
            &[
                f(
                    "datetime",
                    FieldKind::String,
                    true,
                    "Phone-provided date string accepted by date -s.",
                ),
                f(
                    "time",
                    FieldKind::String,
                    false,
                    "Phone-provided local HH:mm:ss time string for UI display.",
                ),
            ],
            r#"{"datetime":"2026-05-28T20:00:00Z","time":"16:00:00"}"#,
            "Phone time response.",
        ),
        "Forwarded to the companion app; daemon uses datetime to set system time.",
    ),
    method(
        "device.power.reboot",
        Family::Device,
        "device.power.reboot",
        &[],
        EMPTY_PAYLOAD,
        SUCCESS_RESPONSE,
        "Runs sync then reboot.",
    ),
    method(
        "device.power.shutdown",
        Family::Device,
        "device.power.shutdown",
        &[],
        EMPTY_PAYLOAD,
        SUCCESS_RESPONSE,
        "Runs sync then halt.",
    ),
    method(
        "device.power.off",
        Family::Device,
        "device.power.shutdown",
        &[],
        EMPTY_PAYLOAD,
        SUCCESS_RESPONSE,
        "Canonical power-off spelling from the audit; current daemon only implements device.power.shutdown.",
    ),
    method(
        "device.factory_reset",
        Family::Device,
        "device.factoryreset",
        &[],
        EMPTY_PAYLOAD,
        SUCCESS_RESPONSE,
        "Sets firstboot flag, syncs, then reboots.",
    ),
    method(
        "reset_boot_counter",
        Family::Device,
        "reset_boot_counter",
        &[],
        EMPTY_PAYLOAD,
        SUCCESS_RESPONSE,
        "Runs phb -r 1 when the UI WebSocket opens.",
    ),
    method(
        "device.brightness.get",
        Family::Device,
        "device.brightness.get",
        &[],
        EMPTY_PAYLOAD,
        BRIGHTNESS_RESPONSE,
        "Reads persisted brightness config.",
    ),
    method(
        "device.brightness.set",
        Family::Device,
        "device.brightness.set",
        &[],
        payload(
            &[f(
                "brightness",
                FieldKind::U8,
                true,
                "Backlight value, inverted Car Thing scale 0..160.",
            )],
            r#"{"brightness":113}"#,
            "Set manual brightness.",
        ),
        BRIGHTNESS_RESPONSE,
        "Writes backlight brightness and disables auto brightness.",
    ),
    method(
        "device.brightness.auto",
        Family::Device,
        "device.brightness.auto",
        &[],
        payload(
            &[f(
                "enabled",
                FieldKind::Bool,
                true,
                "Whether native auto-brightness should run.",
            )],
            r#"{"enabled":true}"#,
            "Enable or disable native auto brightness.",
        ),
        BRIGHTNESS_RESPONSE,
        "Starts/stops the native ALS brightness loop.",
    ),
    method(
        "device.display.get",
        Family::Device,
        "device.display.get",
        &[],
        EMPTY_PAYLOAD,
        DISPLAY_STATE_RESPONSE,
        "Reads the current display sleep state and the saved brightness config it will restore.",
    ),
    method(
        "device.display.sleep",
        Family::Device,
        "device.display.sleep",
        &[],
        EMPTY_PAYLOAD,
        DISPLAY_STATE_RESPONSE,
        "Transiently sleeps the backlight without persisting brightness; separate from the UI lock screen.",
    ),
    method(
        "device.display.wake",
        Family::Device,
        "device.display.wake",
        &[],
        EMPTY_PAYLOAD,
        DISPLAY_STATE_RESPONSE,
        "Wakes the backlight, restoring the saved manual value or restarting auto brightness.",
    ),
    method(
        "device.ab.get",
        Family::Device,
        "device.ab.get",
        &[],
        EMPTY_PAYLOAD,
        payload(
            &[
                f("active_slot", FieldKind::U8, true, "Active slot index."),
                f("active_slot_letter", FieldKind::String, true, "A or B."),
                f(
                    "version_major",
                    FieldKind::U8,
                    true,
                    "A/B metadata major version.",
                ),
                f(
                    "version_minor",
                    FieldKind::U8,
                    true,
                    "A/B metadata minor version.",
                ),
                f("slots", FieldKind::ObjectArray, true, "Two slot records."),
                f("crc32", FieldKind::U32, true, "Metadata CRC32."),
            ],
            r#"{"active_slot":0,"active_slot_letter":"A","version_major":1,"version_minor":0,"slots":[{"priority":15,"tries_remaining":7,"successful_boot":1},{"priority":14,"tries_remaining":7,"successful_boot":0}],"crc32":305419896}"#,
            "Legacy A/B metadata JSON.",
        ),
        "Reads A/B metadata from /dev/misc.",
    ),
    method(
        "device.ab.reset",
        Family::Device,
        "device.ab.reset",
        &[],
        EMPTY_PAYLOAD,
        payload(
            &[
                f("active_slot", FieldKind::U8, true, "Active slot index."),
                f("active_slot_letter", FieldKind::String, true, "A or B."),
                f(
                    "version_major",
                    FieldKind::U8,
                    true,
                    "A/B metadata major version.",
                ),
                f(
                    "version_minor",
                    FieldKind::U8,
                    true,
                    "A/B metadata minor version.",
                ),
                f("slots", FieldKind::ObjectArray, true, "Two slot records."),
                f("crc32", FieldKind::U32, true, "Metadata CRC32."),
            ],
            r#"{"active_slot":0,"active_slot_letter":"A","version_major":1,"version_minor":0,"slots":[{"priority":15,"tries_remaining":7,"successful_boot":0},{"priority":14,"tries_remaining":7,"successful_boot":0}],"crc32":305419896}"#,
            "Legacy A/B metadata JSON.",
        ),
        "Resets A/B metadata to defaults.",
    ),
    method(
        "device.ab.set_slot",
        Family::Device,
        "device.ab.setSlot",
        &[],
        payload(
            &[f("slot", FieldKind::U8, true, "Slot index, 0 or 1.")],
            r#"{"slot":1}"#,
            "Select active slot.",
        ),
        payload(
            &[
                f("active_slot", FieldKind::U8, true, "Active slot index."),
                f("active_slot_letter", FieldKind::String, true, "A or B."),
                f(
                    "version_major",
                    FieldKind::U8,
                    true,
                    "A/B metadata major version.",
                ),
                f(
                    "version_minor",
                    FieldKind::U8,
                    true,
                    "A/B metadata minor version.",
                ),
                f("slots", FieldKind::ObjectArray, true, "Two slot records."),
                f("crc32", FieldKind::U32, true, "Metadata CRC32."),
            ],
            r#"{"active_slot":1,"active_slot_letter":"B","slots":[],"version_major":1,"version_minor":0,"crc32":305419896}"#,
            "Legacy A/B metadata JSON.",
        ),
        "Canonical snake_case for current device.ab.setSlot.",
    ),
    method(
        "device.ab.set_boot_result",
        Family::Device,
        "device.ab.setBootResult",
        &[],
        payload(
            &[f(
                "result",
                FieldKind::I64,
                true,
                "0 triggers failover; 1 marks active boot successful.",
            )],
            r#"{"result":1}"#,
            "Set boot result.",
        ),
        payload(
            &[
                f("active_slot", FieldKind::U8, true, "Active slot index."),
                f("active_slot_letter", FieldKind::String, true, "A or B."),
                f("slots", FieldKind::ObjectArray, true, "Two slot records."),
                f("crc32", FieldKind::U32, true, "Metadata CRC32."),
            ],
            r#"{"active_slot":0,"active_slot_letter":"A","slots":[],"crc32":305419896}"#,
            "Legacy A/B metadata JSON.",
        ),
        "Canonical snake_case for current device.ab.setBootResult.",
    ),
    method(
        "device.ab.failover",
        Family::Device,
        "device.ab.failover",
        &[],
        EMPTY_PAYLOAD,
        payload(
            &[
                f("active_slot", FieldKind::U8, true, "Active slot index."),
                f("active_slot_letter", FieldKind::String, true, "A or B."),
                f("slots", FieldKind::ObjectArray, true, "Two slot records."),
                f("crc32", FieldKind::U32, true, "Metadata CRC32."),
            ],
            r#"{"active_slot":1,"active_slot_letter":"B","slots":[],"crc32":305419896}"#,
            "Legacy A/B metadata JSON.",
        ),
        "Switches active A/B slot.",
    ),
    method(
        "onboarding.set_state",
        Family::Device,
        "onboarding.set_state",
        &[],
        payload(
            &[f(
                "state",
                FieldKind::String,
                true,
                "Onboarding state selected by the UI/app.",
            )],
            r#"{"state":"complete"}"#,
            "Onboarding state update.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Forwarded to companion app.",
    ),
    method(
        "audio.record.start",
        Family::Audio,
        "audio.record.start",
        &[],
        EMPTY_PAYLOAD,
        payload(
            &[f("status", FieldKind::String, true, "recording.")],
            r#"{"status":"recording"}"#,
            "Recording start acknowledgement.",
        ),
        "Starts local microphone capture and pauses wakeword detection.",
    ),
    method(
        "audio.record.stop",
        Family::Audio,
        "audio.record.stop",
        &[],
        EMPTY_PAYLOAD,
        payload(
            &[f("status", FieldKind::String, true, "idle.")],
            r#"{"status":"idle"}"#,
            "Recording stop acknowledgement.",
        ),
        "Stops local microphone capture.",
    ),
    method(
        "wakeword.pause",
        Family::Voice,
        "wakeword.pause",
        &[],
        EMPTY_PAYLOAD,
        payload(
            &[f("status", FieldKind::String, true, "paused.")],
            r#"{"status":"paused"}"#,
            "Wakeword pause acknowledgement.",
        ),
        "Pauses wakeword detection and persists the muted preference for manual calls.",
    ),
    method(
        "wakeword.resume",
        Family::Voice,
        "wakeword.resume",
        &[],
        EMPTY_PAYLOAD,
        payload(
            &[f("status", FieldKind::String, true, "resumed.")],
            r#"{"status":"resumed"}"#,
            "Wakeword resume acknowledgement.",
        ),
        "Resumes wakeword detection and persists the unmuted preference for manual calls.",
    ),
    method(
        "tts.speak",
        Family::Voice,
        "tts.speak",
        &[],
        payload(
            &[
                f("text", FieldKind::String, true, "Text to speak."),
                f(
                    "voice",
                    FieldKind::String,
                    false,
                    "Optional voice identifier.",
                ),
            ],
            r#"{"text":"Hello"}"#,
            "Text-to-speech request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Forwarded to companion app.",
    ),
    method(
        "tts.stop",
        Family::Voice,
        "tts.stop",
        &[],
        EMPTY_PAYLOAD,
        OPAQUE_JSON_PAYLOAD,
        "Forwarded to companion app.",
    ),
    method(
        "voice.cancel",
        Family::Voice,
        "voice.cancel",
        &[],
        EMPTY_PAYLOAD,
        OPAQUE_JSON_PAYLOAD,
        "Stops local audio capture, then forwarded to companion app.",
    ),
    method(
        "media.control.play",
        Family::MediaControl,
        "media.control.play",
        &[],
        EMPTY_PAYLOAD,
        STATUS_OK_RESPONSE,
        "Sends HID Play.",
    ),
    method(
        "media.control.pause",
        Family::MediaControl,
        "media.control.pause",
        &[],
        EMPTY_PAYLOAD,
        STATUS_OK_RESPONSE,
        "Sends HID Pause.",
    ),
    method(
        "media.control.next",
        Family::MediaControl,
        "media.control.next",
        &[],
        EMPTY_PAYLOAD,
        STATUS_OK_RESPONSE,
        "Sends HID Next.",
    ),
    method(
        "media.control.previous",
        Family::MediaControl,
        "media.control.previous",
        &["media.control.prev"],
        EMPTY_PAYLOAD,
        STATUS_OK_RESPONSE,
        "Sends HID Previous; daemon also accepts media.control.prev.",
    ),
    method(
        "media.control.shuffle",
        Family::MediaControl,
        "media.control.shuffle",
        &[],
        EMPTY_PAYLOAD,
        STATUS_OK_RESPONSE,
        "Sends HID Shuffle.",
    ),
    method(
        "media.control.repeat",
        Family::MediaControl,
        "media.control.repeat",
        &[],
        EMPTY_PAYLOAD,
        STATUS_OK_RESPONSE,
        "Sends HID Repeat.",
    ),
    method(
        "media.control.volume_up",
        Family::MediaControl,
        "media.control.volumeUp",
        &[],
        EMPTY_PAYLOAD,
        STATUS_OK_RESPONSE,
        "Sends HID VolumeUp; source method uses camelCase.",
    ),
    method(
        "media.control.volume_down",
        Family::MediaControl,
        "media.control.volumeDown",
        &[],
        EMPTY_PAYLOAD,
        STATUS_OK_RESPONSE,
        "Sends HID VolumeDown; source method uses camelCase.",
    ),
    method(
        "phone.calls.get",
        Family::Phone,
        "phone.calls.get",
        &[],
        payload(
            &[f(
                "device",
                FieldKind::String,
                true,
                "Bluetooth address of the iPhone whose native iAP2 session should answer.",
            )],
            r#"{"device":"AA:BB:CC:DD:EE:FF"}"#,
            "Connected iPhone to query.",
        ),
        payload(
            &[f(
                "calls",
                FieldKind::ObjectArray,
                true,
                "Complete snapshots for active iPhone calls.",
            )],
            r#"{"calls":[]}"#,
            "Active iPhone call snapshots.",
        ),
        "Returns the calls currently tracked from native iAP2 telephony updates.",
    ),
    method(
        "phone.call.accept",
        Family::Phone,
        "phone.call.accept",
        &[],
        payload(
            &[
                f(
                    "call_id",
                    FieldKind::String,
                    true,
                    "iAP2 CallUUID for the ringing call.",
                ),
                f(
                    "device",
                    FieldKind::String,
                    true,
                    "Bluetooth address of the iPhone that emitted the call.",
                ),
            ],
            r#"{"call_id":"call-1","device":"AA:BB:CC:DD:EE:FF"}"#,
            "Incoming call to accept.",
        ),
        STATUS_OK_RESPONSE,
        "Accepts an incoming iPhone call through the native iAP2 telephony session.",
    ),
    method(
        "phone.call.decline",
        Family::Phone,
        "phone.call.decline",
        &[],
        payload(
            &[
                f(
                    "call_id",
                    FieldKind::String,
                    true,
                    "iAP2 CallUUID for the ringing call.",
                ),
                f(
                    "device",
                    FieldKind::String,
                    true,
                    "Bluetooth address of the iPhone that emitted the call.",
                ),
            ],
            r#"{"call_id":"call-1","device":"AA:BB:CC:DD:EE:FF"}"#,
            "Incoming call to decline.",
        ),
        STATUS_OK_RESPONSE,
        "Declines an incoming iPhone call by ending it through the native iAP2 telephony session.",
    ),
    method(
        "spotify.player.state",
        Family::Spotify,
        "spotify.player.state",
        &[],
        EMPTY_PAYLOAD,
        OPAQUE_JSON_PAYLOAD,
        "Fetch Spotify player state from companion app.",
    ),
    method(
        "spotify.player.play",
        Family::Spotify,
        "spotify.player.play",
        &[],
        payload(
            &[
                f(
                    "context_uri",
                    FieldKind::String,
                    false,
                    "Spotify context URI.",
                ),
                f("uris", FieldKind::StringArray, false, "Track URIs."),
                f("offset", FieldKind::Object, false, "Spotify offset object."),
                f(
                    "device_id",
                    FieldKind::String,
                    false,
                    "Target Spotify device id.",
                ),
            ],
            r#"{"context_uri":"spotify:album:abc","offset":{"position":0},"device_id":"device123"}"#,
            "Start Spotify playback.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Forwarded Spotify playback request.",
    ),
    method(
        "spotify.player.pause",
        Family::Spotify,
        "spotify.player.pause",
        &[],
        EMPTY_PAYLOAD,
        OPAQUE_JSON_PAYLOAD,
        "Pause Spotify playback.",
    ),
    method(
        "spotify.player.next",
        Family::Spotify,
        "spotify.player.next",
        &[],
        EMPTY_PAYLOAD,
        OPAQUE_JSON_PAYLOAD,
        "Skip to next Spotify item.",
    ),
    method(
        "spotify.player.previous",
        Family::Spotify,
        "spotify.player.previous",
        &[],
        EMPTY_PAYLOAD,
        OPAQUE_JSON_PAYLOAD,
        "Skip to previous Spotify item.",
    ),
    method(
        "spotify.player.seek",
        Family::Spotify,
        "spotify.player.seek",
        &[],
        payload(
            &[f(
                "position_ms",
                FieldKind::U64,
                true,
                "Target playback position in milliseconds.",
            )],
            r#"{"position_ms":90000}"#,
            "Seek request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Seek Spotify playback.",
    ),
    method(
        "spotify.player.volume",
        Family::Spotify,
        "spotify.player.volume",
        &[],
        payload(
            &[f(
                "volume_percent",
                FieldKind::U8,
                true,
                "Spotify volume 0..100.",
            )],
            r#"{"volume_percent":75}"#,
            "Volume request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Set Spotify volume.",
    ),
    method(
        "spotify.player.shuffle",
        Family::Spotify,
        "spotify.player.shuffle",
        &[],
        payload(
            &[f(
                "state",
                FieldKind::Bool,
                true,
                "Shuffle enabled. Current UI has historically sent stringified booleans; canonical is bool.",
            )],
            r#"{"state":true}"#,
            "Shuffle request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Set Spotify shuffle.",
    ),
    method(
        "spotify.player.repeat",
        Family::Spotify,
        "spotify.player.repeat",
        &[],
        payload(
            &[f(
                "state",
                FieldKind::String,
                true,
                "Repeat mode: off, track, or context.",
            )],
            r#"{"state":"context"}"#,
            "Repeat request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Set Spotify repeat.",
    ),
    method(
        "spotify.player.transfer",
        Family::Spotify,
        "spotify.player.transfer",
        &[],
        payload(
            &[
                f(
                    "device_ids",
                    FieldKind::StringArray,
                    true,
                    "Target Spotify device ids.",
                ),
                f(
                    "play",
                    FieldKind::Bool,
                    false,
                    "Whether to start playback after transfer.",
                ),
            ],
            r#"{"device_ids":["device123"],"play":true}"#,
            "Transfer playback request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Transfer Spotify playback.",
    ),
    method(
        "spotify.player.speed",
        Family::Spotify,
        "spotify.player.speed",
        &[],
        payload(
            &[f(
                "speed",
                FieldKind::F64,
                true,
                "Playback speed multiplier.",
            )],
            r#"{"speed":1.25}"#,
            "Playback speed request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Set podcast/audiobook playback speed.",
    ),
    method(
        "spotify.player.queue",
        Family::Spotify,
        "spotify.player.queue",
        &[],
        EMPTY_PAYLOAD,
        OPAQUE_JSON_PAYLOAD,
        "Fetch Spotify queue.",
    ),
    method(
        "spotify.player.queue.add",
        Family::Spotify,
        "spotify.player.queue.add",
        &[],
        payload(
            &[
                f("uri", FieldKind::String, true, "Spotify item URI to add."),
                f(
                    "device_id",
                    FieldKind::String,
                    false,
                    "Target Spotify device id.",
                ),
            ],
            r#"{"uri":"spotify:track:abc"}"#,
            "Queue add request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Add an item to the Spotify queue.",
    ),
    method(
        "spotify.artist.get",
        Family::Spotify,
        "spotify.artist.get",
        &[],
        payload(
            &[fs(
                "content_id",
                "id",
                FieldKind::String,
                true,
                "Spotify artist id. UI currently uses id; canonical is content_id.",
            )],
            r#"{"content_id":"artist123"}"#,
            "Artist lookup request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Fetch artist metadata.",
    ),
    method(
        "spotify.artist.top_tracks",
        Family::Spotify,
        "spotify.artist.topTracks",
        &[],
        payload(
            &[
                fs(
                    "content_id",
                    "id",
                    FieldKind::String,
                    true,
                    "Spotify artist id. Current source method/field are camel/id.",
                ),
                f(
                    "mockingbird",
                    FieldKind::Bool,
                    false,
                    "Include album metadata needed by the mockingbird artist tracklist.",
                ),
            ],
            r#"{"content_id":"artist123","mockingbird":true}"#,
            "Artist top tracks request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Fetch artist top tracks.",
    ),
    method(
        "spotify.album.get",
        Family::Spotify,
        "spotify.album.get",
        &[],
        payload(
            &[fs(
                "content_id",
                "id",
                FieldKind::String,
                true,
                "Spotify album id. UI currently uses id; canonical is content_id.",
            )],
            r#"{"content_id":"album123"}"#,
            "Album lookup request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Fetch album metadata.",
    ),
    method(
        "spotify.album.tracks",
        Family::Spotify,
        "spotify.album.tracks",
        &[],
        payload(
            &[
                fs(
                    "content_id",
                    "id",
                    FieldKind::String,
                    true,
                    "Spotify album id. UI currently uses id; canonical is content_id.",
                ),
                f("limit", FieldKind::U32, false, "Page size."),
                f("offset", FieldKind::U32, false, "Page offset."),
            ],
            r#"{"content_id":"album123","limit":50,"offset":0}"#,
            "Album tracks request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Fetch album tracks.",
    ),
    method(
        "spotify.playlist.get",
        Family::Spotify,
        "spotify.playlist.get",
        &[],
        payload(
            &[
                fs(
                    "content_id",
                    "id",
                    FieldKind::String,
                    true,
                    "Spotify playlist id. UI currently uses id; canonical is content_id.",
                ),
                f("fields", FieldKind::String, false, "Spotify fields filter."),
            ],
            r#"{"content_id":"playlist123","fields":"items(track(name,uri))"}"#,
            "Playlist lookup request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Fetch playlist metadata.",
    ),
    method(
        "spotify.playlist.tracks",
        Family::Spotify,
        "spotify.playlist.tracks",
        &[],
        payload(
            &[
                fs(
                    "content_id",
                    "id",
                    FieldKind::String,
                    true,
                    "Spotify playlist id. UI currently uses id; canonical is content_id.",
                ),
                f("limit", FieldKind::U32, false, "Page size."),
                f("offset", FieldKind::U32, false, "Page offset."),
                f(
                    "mockingbird",
                    FieldKind::Bool,
                    false,
                    "Return compact per-track album artwork for the mockingbird UI.",
                ),
            ],
            r#"{"content_id":"playlist123","limit":50,"offset":0,"mockingbird":true}"#,
            "Playlist tracks request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Fetch playlist tracks.",
    ),
    method(
        "spotify.show.get",
        Family::Spotify,
        "spotify.show.get",
        &[],
        payload(
            &[f("content_id", FieldKind::String, true, "Spotify show id.")],
            r#"{"content_id":"show123"}"#,
            "Show lookup request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Fetch show metadata.",
    ),
    method(
        "spotify.show.episodes",
        Family::Spotify,
        "spotify.show.episodes",
        &[],
        payload(
            &[
                f("content_id", FieldKind::String, true, "Spotify show id."),
                f("limit", FieldKind::U32, false, "Page size."),
                f("offset", FieldKind::U32, false, "Page offset."),
            ],
            r#"{"content_id":"show123","limit":5,"offset":0}"#,
            "Show episodes request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Fetch show episodes.",
    ),
    method(
        "spotify.me.profile",
        Family::Spotify,
        "spotify.me.profile",
        &[],
        EMPTY_PAYLOAD,
        OPAQUE_JSON_PAYLOAD,
        "Fetch current Spotify profile.",
    ),
    method(
        "spotify.me.tracks",
        Family::Spotify,
        "spotify.me.tracks",
        &[],
        payload(
            &[
                f("limit", FieldKind::U32, false, "Page size."),
                f("offset", FieldKind::U32, false, "Page offset."),
            ],
            r#"{"limit":5,"offset":0}"#,
            "Saved tracks request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Fetch saved tracks.",
    ),
    method(
        "spotify.me.tracks.contains",
        Family::Spotify,
        "spotify.me.tracks.contains",
        &[],
        payload(
            &[f("ids", FieldKind::StringArray, true, "Spotify track ids.")],
            r#"{"ids":["track123"]}"#,
            "Saved-track contains request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Check saved tracks.",
    ),
    method(
        "spotify.me.tracks.save",
        Family::Spotify,
        "spotify.me.tracks.save",
        &[],
        payload(
            &[f("ids", FieldKind::StringArray, true, "Spotify track ids.")],
            r#"{"ids":["track123"]}"#,
            "Save tracks request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Save tracks to library.",
    ),
    method(
        "spotify.me.tracks.remove",
        Family::Spotify,
        "spotify.me.tracks.remove",
        &[],
        payload(
            &[f("ids", FieldKind::StringArray, true, "Spotify track ids.")],
            r#"{"ids":["track123"]}"#,
            "Remove tracks request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Remove saved tracks.",
    ),
    method(
        "spotify.me.playlists",
        Family::Spotify,
        "spotify.me.playlists",
        &[],
        payload(
            &[
                f("limit", FieldKind::U32, false, "Page size."),
                f("offset", FieldKind::U32, false, "Page offset."),
            ],
            r#"{"limit":5,"offset":0}"#,
            "User playlists request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Fetch current user's playlists.",
    ),
    method(
        "spotify.me.shows",
        Family::Spotify,
        "spotify.me.shows",
        &[],
        payload(
            &[
                f("limit", FieldKind::U32, false, "Page size."),
                f("offset", FieldKind::U32, false, "Page offset."),
            ],
            r#"{"limit":5,"offset":0}"#,
            "User shows request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Fetch saved shows.",
    ),
    method(
        "spotify.me.shows.save",
        Family::Spotify,
        "spotify.me.shows.save",
        &[],
        payload(
            &[f("ids", FieldKind::StringArray, true, "Spotify show ids.")],
            r#"{"ids":["show123"]}"#,
            "Save shows request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Save shows.",
    ),
    method(
        "spotify.me.shows.remove",
        Family::Spotify,
        "spotify.me.shows.remove",
        &[],
        payload(
            &[f("ids", FieldKind::StringArray, true, "Spotify show ids.")],
            r#"{"ids":["show123"]}"#,
            "Remove shows request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Remove saved shows.",
    ),
    method(
        "spotify.me.shows.contains",
        Family::Spotify,
        "spotify.me.shows.contains",
        &[],
        payload(
            &[f("ids", FieldKind::StringArray, true, "Spotify show ids.")],
            r#"{"ids":["show123"]}"#,
            "Saved-show contains request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Check saved shows.",
    ),
    method(
        "spotify.me.top_artists",
        Family::Spotify,
        "spotify.me.topArtists",
        &[],
        payload(
            &[
                f("limit", FieldKind::U32, false, "Page size."),
                f("offset", FieldKind::U32, false, "Page offset."),
                f(
                    "time_range",
                    FieldKind::String,
                    false,
                    "Spotify time range.",
                ),
            ],
            r#"{"limit":5,"time_range":"medium_term"}"#,
            "Top artists request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Fetch current user's top artists.",
    ),
    method(
        "spotify.me.top_tracks",
        Family::Spotify,
        "spotify.me.topTracks",
        &[],
        payload(
            &[
                f("limit", FieldKind::U32, false, "Page size."),
                f("offset", FieldKind::U32, false, "Page offset."),
                f(
                    "time_range",
                    FieldKind::String,
                    false,
                    "Spotify time range.",
                ),
            ],
            r#"{"limit":5,"time_range":"medium_term"}"#,
            "Top tracks request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Fetch current user's top tracks.",
    ),
    method(
        "spotify.me.recently_played",
        Family::Spotify,
        "spotify.me.recentlyPlayed",
        &[],
        payload(
            &[
                f("limit", FieldKind::U32, false, "Page size."),
                f(
                    "after",
                    FieldKind::U64,
                    false,
                    "Unix timestamp millis lower bound.",
                ),
                f(
                    "before",
                    FieldKind::U64,
                    false,
                    "Unix timestamp millis upper bound.",
                ),
            ],
            r#"{"limit":20}"#,
            "Recently played request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Fetch recently played tracks.",
    ),
    method(
        "spotify.devices",
        Family::Spotify,
        "spotify.devices",
        &[],
        EMPTY_PAYLOAD,
        OPAQUE_JSON_PAYLOAD,
        "Fetch Spotify playback devices.",
    ),
    method(
        "spotify.radio.mixes",
        Family::Spotify,
        "spotify.radio.mixes",
        &[],
        EMPTY_PAYLOAD,
        OPAQUE_JSON_PAYLOAD,
        "Fetch Spotify radio mixes.",
    ),
    method(
        "spotify.radio.playlist",
        Family::Spotify,
        "spotify.radio.playlist",
        &[],
        payload(
            &[fs(
                "content_id",
                "id",
                FieldKind::String,
                false,
                "Spotify playlist/content id for radio seed.",
            )],
            r#"{"content_id":"playlist123"}"#,
            "Radio playlist request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Fetch/generate playlist radio.",
    ),
    method(
        "spotify.radio.top_mix",
        Family::Spotify,
        "spotify.radio.topMix",
        &[],
        EMPTY_PAYLOAD,
        OPAQUE_JSON_PAYLOAD,
        "Fetch top mix radio.",
    ),
    method(
        "spotify.radio.discoveries",
        Family::Spotify,
        "spotify.radio.discoveries",
        &[],
        EMPTY_PAYLOAD,
        OPAQUE_JSON_PAYLOAD,
        "Fetch discovery radio items.",
    ),
    method(
        "spotify.track.lyrics",
        Family::Spotify,
        "spotify.track.lyrics",
        &[],
        payload(
            &[fs(
                "content_id",
                "id",
                FieldKind::String,
                true,
                "Spotify track id.",
            )],
            r#"{"content_id":"track123"}"#,
            "Lyrics request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Fetch track lyrics.",
    ),
    method(
        "spotify.dj.start",
        Family::Spotify,
        "spotify.dj.start",
        &[],
        EMPTY_PAYLOAD,
        OPAQUE_JSON_PAYLOAD,
        "Start Spotify DJ session.",
    ),
    method(
        "spotify.dj.signal",
        Family::Spotify,
        "spotify.dj.signal",
        &[],
        payload(
            &[
                f("signal", FieldKind::String, true, "DJ signal name."),
                f(
                    "payload",
                    FieldKind::Json,
                    false,
                    "Signal-specific payload.",
                ),
            ],
            r#"{"signal":"skip"}"#,
            "DJ signal request.",
        ),
        OPAQUE_JSON_PAYLOAD,
        "Send a Spotify DJ signal.",
    ),
    method(
        "spotify.auth.get_status",
        Family::Spotify,
        "spotify.auth.getStatus",
        &[],
        EMPTY_PAYLOAD,
        payload(
            &[
                f(
                    "authenticated",
                    FieldKind::Bool,
                    false,
                    "Whether Spotify is authenticated.",
                ),
                f(
                    "skipped",
                    FieldKind::Bool,
                    false,
                    "Whether auth was skipped.",
                ),
            ],
            r#"{"authenticated":true,"skipped":false}"#,
            "Spotify auth status response.",
        ),
        "Fetch Spotify auth status; source method uses getStatus.",
    ),
    method(
        "spotify.image.fetch",
        Family::Spotify,
        "spotify.image.fetch",
        &[],
        payload(
            &[f("url", FieldKind::String, true, "Image URL.")],
            r#"{"url":"https://i.scdn.co/image/example"}"#,
            "Image fetch request.",
        ),
        payload(
            &[
                f("url", FieldKind::String, true, "Image URL."),
                f("data", FieldKind::BytesBase64, true, "Base64 image data."),
                fs(
                    "content_type",
                    "contentType",
                    FieldKind::String,
                    true,
                    "Image MIME type. Current daemon uses contentType.",
                ),
            ],
            r#"{"url":"https://i.scdn.co/image/example","data":"/9j/4AAQ","content_type":"image/jpeg"}"#,
            "Image fetch/cache response.",
        ),
        "Fetches album art through cache, then companion app on miss.",
    ),
    method(
        "ping",
        Family::BtOnly,
        "ping",
        &[],
        EMPTY_PAYLOAD,
        payload(
            &[f("pong", FieldKind::String, true, "Pong string.")],
            r#"{"pong":"hello from nocturne"}"#,
            "Ping response.",
        ),
        "BT MsgPack default liveness call.",
    ),
    method(
        "device.volume.update",
        Family::BtOnly,
        "device.volume.update",
        &[],
        payload(
            &[fs(
                "volume_percent",
                "volumePercent",
                FieldKind::U8,
                true,
                "Phone media volume 0..100. Current app field is volumePercent.",
            )],
            r#"{"volume_percent":42}"#,
            "Phone volume update.",
        ),
        payload(
            &[f(
                "success",
                FieldKind::Bool,
                true,
                "Whether update was accepted.",
            )],
            r#"{"success":true}"#,
            "Volume update acknowledgement.",
        ),
        "BT-only phone volume call that broadcasts phone.volume.update to WS clients.",
    ),
];

pub const EVENT_INVENTORY: &[Event] = &[
    event(
        "app.ready",
        Family::Device,
        "app.ready",
        &[],
        payload(
            &[
                f(
                    "datetime",
                    FieldKind::String,
                    false,
                    "Phone datetime for daemon time sync.",
                ),
                f("timezone", FieldKind::Object, false, "Phone timezone."),
                f(
                    "platform",
                    FieldKind::String,
                    false,
                    "ios, android, or web.",
                ),
                f(
                    "subscribed",
                    FieldKind::Bool,
                    false,
                    "Subscription entitlement.",
                ),
                fs(
                    "subscription_status",
                    "subscriptionStatus",
                    FieldKind::String,
                    false,
                    "Subscription status; current app uses camelCase.",
                ),
                fs(
                    "has_lifetime",
                    "hasLifetime",
                    FieldKind::Bool,
                    false,
                    "Lifetime entitlement; current app uses camelCase.",
                ),
                fs(
                    "is_admin",
                    "isAdmin",
                    FieldKind::Bool,
                    false,
                    "Admin entitlement from the authenticated profile; current app uses camelCase.",
                ),
                fs(
                    "entitlements_verified",
                    "entitlementsVerified",
                    FieldKind::Bool,
                    false,
                    "Whether entitlements were verified for the current authenticated user; current app uses camelCase.",
                ),
                fs(
                    "spotify_skipped",
                    "spotifySkipped",
                    FieldKind::Bool,
                    false,
                    "Spotify auth skipped; current app uses camelCase.",
                ),
            ],
            r#"{"datetime":"2026-05-28T20:00:00Z","timezone":{"identifier":"America/Los_Angeles"},"platform":"ios","subscribed":true,"subscription_status":"active","has_lifetime":false,"is_admin":false,"entitlements_verified":true,"spotify_skipped":false}"#,
            "Companion readiness event. Current payload mixes snake/camel; canonical is snake_case.",
        ),
        "Phone app ready event cached and replayed to WS clients.",
    ),
    event(
        "subscription.updated",
        Family::Device,
        "subscription.updated",
        &[],
        payload(
            &[
                f(
                    "subscribed",
                    FieldKind::Bool,
                    false,
                    "Subscription entitlement.",
                ),
                fs(
                    "subscription_status",
                    "subscriptionStatus",
                    FieldKind::String,
                    false,
                    "Subscription status; current app uses camelCase.",
                ),
                fs(
                    "has_lifetime",
                    "hasLifetime",
                    FieldKind::Bool,
                    false,
                    "Lifetime entitlement; current app uses camelCase.",
                ),
                fs(
                    "is_admin",
                    "isAdmin",
                    FieldKind::Bool,
                    false,
                    "Admin entitlement from the authenticated profile; current app uses camelCase.",
                ),
                fs(
                    "entitlements_verified",
                    "entitlementsVerified",
                    FieldKind::Bool,
                    false,
                    "Whether entitlements were verified for the current authenticated user; current app uses camelCase.",
                ),
            ],
            r#"{"subscribed":true,"subscription_status":"active","has_lifetime":false,"is_admin":false,"entitlements_verified":true}"#,
            "Subscription update event.",
        ),
        "Updates cached app.ready subscription fields.",
    ),
    event(
        "network.status",
        Family::Device,
        "network.status",
        &[],
        payload(
            &[f(
                "status",
                FieldKind::String,
                true,
                "connected or disconnected.",
            )],
            r#"{"status":"connected"}"#,
            "Network connectivity event.",
        ),
        "Phone network status forwarded to UI.",
    ),
    event(
        "notification.show",
        Family::Device,
        "notification.show",
        &[],
        payload(
            &[
                f("id", FieldKind::String, false, "Notification id."),
                f("title", FieldKind::String, true, "Notification title."),
                f("body", FieldKind::String, false, "Notification body."),
                f(
                    "subtitle",
                    FieldKind::String,
                    false,
                    "Secondary notification text.",
                ),
                f(
                    "category",
                    FieldKind::String,
                    false,
                    "Notification category.",
                ),
                fs(
                    "days_until_expiry",
                    "daysUntilExpiry",
                    FieldKind::I64,
                    false,
                    "Subscription expiry countdown; current app uses camelCase.",
                ),
                f("timestamp", FieldKind::U64, false, "Unix timestamp millis."),
                f(
                    "app_bundle_id",
                    FieldKind::String,
                    false,
                    "Originating iOS app bundle identifier.",
                ),
                f(
                    "app_name",
                    FieldKind::String,
                    false,
                    "Originating app display name when available.",
                ),
                f(
                    "silent",
                    FieldKind::Bool,
                    false,
                    "Whether the source notification is silent.",
                ),
                f(
                    "important",
                    FieldKind::Bool,
                    false,
                    "Whether the source marked the notification important.",
                ),
                f(
                    "pre_existing",
                    FieldKind::Bool,
                    false,
                    "Whether the notification predates the current ANCS session.",
                ),
            ],
            r#"{"id":"ancs:42","title":"Alex","body":"On my way","subtitle":"Messages","category":"ios.social","timestamp":1713000000000,"app_bundle_id":"com.apple.MobileSMS","app_name":"Messages","silent":false,"important":false,"pre_existing":false}"#,
            "Notification event.",
        ),
        "UI notification from the phone companion or native iOS ANCS.",
    ),
    event(
        "notification.remove",
        Family::Device,
        "notification.remove",
        &[],
        payload(
            &[f(
                "id",
                FieldKind::String,
                true,
                "Notification id to remove.",
            )],
            r#"{"id":"ancs:42"}"#,
            "Notification removal event.",
        ),
        "Removes a previously shown phone notification from the UI.",
    ),
    event(
        "bluetooth.agent",
        Family::Bluetooth,
        "bluetooth.agent",
        &[],
        payload(
            &[
                f(
                    "event",
                    FieldKind::String,
                    false,
                    "Agent callback event name.",
                ),
                f(
                    "device",
                    FieldKind::String,
                    false,
                    "BlueZ D-Bus device path.",
                ),
                f("address", FieldKind::String, false, "Bluetooth address."),
                f("name", FieldKind::String, false, "Device display name."),
                f(
                    "pin",
                    FieldKind::String,
                    false,
                    "PIN/passkey displayed to user.",
                ),
                f(
                    "pincode",
                    FieldKind::String,
                    false,
                    "PIN code for RequestPinCode.",
                ),
                f(
                    "type",
                    FieldKind::String,
                    false,
                    "Legacy event type, e.g. bluetooth_pin.",
                ),
                f("passkey", FieldKind::U32, false, "Numeric passkey."),
                f("entered", FieldKind::U16, false, "Digits entered."),
                f("uuid", FieldKind::String, false, "Authorized service UUID."),
                f("accepted", FieldKind::Bool, false, "Auto-accept result."),
            ],
            r#"{"type":"bluetooth_pin","address":"AA:BB:CC:DD:EE:FF","name":"iPhone","pin":"123456"}"#,
            "Bluetooth agent event union.",
        ),
        "D-Bus pairing-agent events forwarded to UI.",
    ),
    event(
        "bluetooth.pairing",
        Family::Bluetooth,
        "bluetooth.pairing",
        &[],
        payload(
            &[
                f("event", FieldKind::String, false, "paired or unpaired."),
                f(
                    "type",
                    FieldKind::String,
                    false,
                    "Legacy type, e.g. pairing_succeeded.",
                ),
                f("device", FieldKind::String, true, "Device path or address."),
            ],
            r#"{"type":"pairing_succeeded","device":"/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF"}"#,
            "Pairing event.",
        ),
        "Pairing state change event.",
    ),
    event(
        "bluetooth.connection",
        Family::Bluetooth,
        "bluetooth.connection",
        &[],
        payload(
            &[
                f(
                    "event",
                    FieldKind::String,
                    true,
                    "connecting, connector_probe, connection_established, or connection_closed.",
                ),
                f("device", FieldKind::String, true, "Device address."),
                f(
                    "connection_type",
                    FieldKind::String,
                    false,
                    "rfcomm, iap2, generic, android, or auto.",
                ),
                f(
                    "device_type",
                    FieldKind::String,
                    false,
                    "Detected peer type.",
                ),
                f("channel", FieldKind::U8, false, "RFCOMM channel."),
                f("initiated_by", FieldKind::String, false, "daemon or user."),
            ],
            r#"{"event":"connection_established","device":"AA:BB:CC:DD:EE:FF","connection_type":"iap2","device_type":"iphone","channel":1,"initiated_by":"daemon"}"#,
            "Bluetooth connection event.",
        ),
        "Bluetooth connection lifecycle event.",
    ),
    event(
        "bluetooth.device",
        Family::Bluetooth,
        "bluetooth.device",
        &[],
        payload(
            &[
                f(
                    "event",
                    FieldKind::String,
                    true,
                    "connected, disconnected, removed, or unpaired.",
                ),
                f("device", FieldKind::String, true, "Device address."),
            ],
            r#"{"event":"removed","device":"AA:BB:CC:DD:EE:FF"}"#,
            "Bluetooth device event.",
        ),
        "BlueZ device property/removal event.",
    ),
    event(
        "bluetooth.discoverable",
        Family::Bluetooth,
        "bluetooth.discoverable",
        &[],
        payload(
            &[f(
                "discoverable",
                FieldKind::Bool,
                true,
                "Requested discoverable state.",
            )],
            r#"{"discoverable":true}"#,
            "Discoverability event.",
        ),
        "Broadcast after discoverability request.",
    ),
    event(
        "bluetooth.mfi",
        Family::Bluetooth,
        "bluetooth.mfi",
        &[],
        payload(
            &[
                f(
                    "event",
                    FieldKind::String,
                    true,
                    "authentication_started, authentication_succeeded, or authentication_failed.",
                ),
                f("device", FieldKind::String, true, "Device address."),
                f("reason", FieldKind::String, false, "Failure reason."),
            ],
            r#"{"event":"authentication_succeeded","device":"AA:BB:CC:DD:EE:FF"}"#,
            "MFi authentication event.",
        ),
        "Current daemon emits bluetooth.mfi during iAP2 auth; not in the prior WS audit but present in hot files.",
    ),
    event(
        "voice.wakeword",
        Family::Voice,
        "voice.wakeword",
        &[],
        payload(
            &[
                f(
                    "keyword",
                    FieldKind::String,
                    true,
                    "Detected wake word keyword.",
                ),
                f("confidence", FieldKind::F64, true, "Classifier confidence."),
            ],
            r#"{"keyword":"nocturne","confidence":0.91}"#,
            "Wakeword detection event.",
        ),
        "Emitted when the local wake word detector fires.",
    ),
    event(
        "voice.wakeword.state",
        Family::Voice,
        "voice.wakeword.state",
        &[],
        payload(
            &[f(
                "muted",
                FieldKind::Bool,
                true,
                "Whether wakeword detection is muted.",
            )],
            r#"{"muted":false}"#,
            "Wakeword muted state.",
        ),
        "Cached and replayed to new WS clients.",
    ),
    event(
        "voice.transcription",
        Family::Voice,
        "voice.transcription",
        &[],
        payload(
            &[
                f("transcript", FieldKind::String, true, "Transcribed text."),
                f(
                    "is_final",
                    FieldKind::Bool,
                    true,
                    "Whether this transcript is final.",
                ),
                f(
                    "session_id",
                    FieldKind::String,
                    false,
                    "Voice session identifier used to reject stale turn events.",
                ),
            ],
            r#"{"transcript":"play some music","is_final":true,"session_id":"turn-1"}"#,
            "Voice transcription event.",
        ),
        "Forwarded from companion voice stack.",
    ),
    event(
        "ai.state",
        Family::Voice,
        "ai.state",
        &[],
        payload(
            &[
                f("state", FieldKind::String, true, "Assistant state."),
                f("message", FieldKind::String, false, "Optional status text."),
                f(
                    "session_id",
                    FieldKind::String,
                    false,
                    "Voice session identifier used to reject stale turn events.",
                ),
            ],
            r#"{"state":"thinking","session_id":"turn-1"}"#,
            "AI assistant state event.",
        ),
        "Forwarded from companion AI assistant.",
    ),
    event(
        "ai.response",
        Family::Voice,
        "ai.response",
        &[],
        payload(
            &[
                f(
                    "message",
                    FieldKind::String,
                    false,
                    "Assistant response text.",
                ),
                f(
                    "text",
                    FieldKind::String,
                    false,
                    "Legacy response text alias.",
                ),
                f(
                    "is_final",
                    FieldKind::Bool,
                    false,
                    "Whether this response chunk is final.",
                ),
                f(
                    "session_id",
                    FieldKind::String,
                    false,
                    "Voice session identifier used to reject stale turn events.",
                ),
            ],
            r#"{"message":"Done","is_final":true,"session_id":"turn-1"}"#,
            "AI assistant response event.",
        ),
        "Forwarded from companion AI assistant.",
    ),
    event(
        "ai.tool_executed",
        Family::Voice,
        "ai.tool_executed",
        &[],
        payload(
            &[
                f("tool_name", FieldKind::String, false, "Executed tool name."),
                f(
                    "tool",
                    FieldKind::String,
                    false,
                    "Legacy executed tool name alias.",
                ),
                f("call_id", FieldKind::String, false, "LLM tool-call id."),
                f("status", FieldKind::String, false, "Tool execution status."),
                f(
                    "tool_arguments",
                    FieldKind::Json,
                    false,
                    "Tool arguments decoded from the LLM call.",
                ),
                f("result", FieldKind::Json, false, "Tool-specific result."),
                f("error", FieldKind::String, false, "Tool error text."),
                f(
                    "session_id",
                    FieldKind::String,
                    false,
                    "Voice session identifier used to reject stale turn events.",
                ),
            ],
            r#"{"tool_name":"spotify_play","tool":"spotify_play","call_id":"call-1","status":"completed","tool_arguments":{"uri":"spotify:track:123"},"result":{"ok":true},"session_id":"turn-1"}"#,
            "AI tool execution event.",
        ),
        "Forwarded from companion AI assistant.",
    ),
    event(
        "audio.level",
        Family::Audio,
        "audio.level",
        &[],
        payload(
            &[f(
                "level",
                FieldKind::F64,
                true,
                "Normalized microphone level 0..1.",
            )],
            r#"{"level":0.42}"#,
            "Mic level event.",
        ),
        "Local mic level broadcast for UI visualization.",
    ),
    event(
        "media.now_playing.update",
        Family::MediaControl,
        "media.nowPlaying.update",
        &[],
        payload(
            &[
                fs(
                    "media_item_attributes",
                    "MediaItemAttributes",
                    FieldKind::Object,
                    false,
                    "Canonical wrapper for iAP2 MediaItemAttributes.",
                ),
                fs(
                    "playback_attributes",
                    "PlaybackAttributes",
                    FieldKind::Object,
                    false,
                    "Canonical wrapper for iAP2 PlaybackAttributes.",
                ),
                f(
                    "media_generation",
                    FieldKind::U64,
                    false,
                    "Optional producer generation correlating metadata with artwork.",
                ),
            ],
            r#"{"media_item_attributes":{"media_item_title":"Song","media_item_artist":"Artist"},"playback_attributes":{"playback_status":"playing"},"media_generation":7}"#,
            "Now-playing update. Current daemon forwards Apple-style PascalCase keys; canonical wrapper is snake_case.",
        ),
        "Now-playing state update from iAP2 or companion.",
    ),
    event(
        "media.now_playing.artwork",
        Family::MediaControl,
        "media.nowPlaying.artwork",
        &[],
        payload(
            &[
                f("data", FieldKind::BytesBase64, true, "Base64 artwork data."),
                fs(
                    "content_type",
                    "contentType",
                    FieldKind::String,
                    true,
                    "Artwork MIME type. Current daemon uses contentType.",
                ),
                f(
                    "media_generation",
                    FieldKind::U64,
                    false,
                    "Optional producer generation correlating artwork with metadata.",
                ),
            ],
            r#"{"data":"/9j/4AAQ","content_type":"image/jpeg","media_generation":7}"#,
            "Artwork event.",
        ),
        "Artwork received via iAP2 file transfer.",
    ),
    event(
        "media.now_playing.artwork.failed",
        Family::MediaControl,
        "media.nowPlaying.artwork.failed",
        &[],
        payload(
            &[f(
                "transfer_id",
                FieldKind::U32,
                true,
                "Failed iAP2 file-transfer id.",
            )],
            r#"{"transfer_id":42}"#,
            "Artwork failure event.",
        ),
        "Signals UI to fall back to Spotify image fetch.",
    ),
    event(
        "phone.volume.update",
        Family::MediaControl,
        "phone.volume.update",
        &[],
        payload(
            &[fs(
                "volume_percent",
                "volumePercent",
                FieldKind::U8,
                true,
                "Phone media volume 0..100. Current daemon broadcasts volumePercent.",
            )],
            r#"{"volume_percent":42}"#,
            "Phone volume event.",
        ),
        "Broadcast after BT device.volume.update call.",
    ),
    event(
        "phone.call.started",
        Family::Phone,
        "phone.call.started",
        &[],
        payload(
            &[
                f("call_id", FieldKind::String, true, "Stable iAP2 CallUUID."),
                f(
                    "device",
                    FieldKind::String,
                    true,
                    "Bluetooth address of the iPhone that emitted the call.",
                ),
                f(
                    "remote_id",
                    FieldKind::String,
                    true,
                    "Raw caller phone number or platform identifier.",
                ),
                f(
                    "display_name",
                    FieldKind::String,
                    true,
                    "Resolved caller or contact name when available.",
                ),
                f(
                    "status",
                    FieldKind::String,
                    true,
                    "Normalized iAP2 call status.",
                ),
                f(
                    "direction",
                    FieldKind::String,
                    true,
                    "Normalized incoming or outgoing direction.",
                ),
                f("label", FieldKind::String, false, "Contact number label."),
                f(
                    "service",
                    FieldKind::String,
                    false,
                    "Telephony or FaceTime service kind.",
                ),
                f(
                    "started_at_unix_s",
                    FieldKind::I64,
                    false,
                    "Call start time in Unix seconds.",
                ),
            ],
            r#"{"call_id":"call-1","device":"AA:BB:CC:DD:EE:FF","remote_id":"+15555550100","display_name":"Test Caller","status":"ringing","direction":"incoming","service":"telephony"}"#,
            "Complete snapshot for a newly tracked iPhone call.",
        ),
        "Broadcast after the first non-disconnected iAP2 state for a call.",
    ),
    event(
        "phone.call.updated",
        Family::Phone,
        "phone.call.updated",
        &[],
        payload(
            &[
                f("call_id", FieldKind::String, true, "Stable iAP2 CallUUID."),
                f(
                    "device",
                    FieldKind::String,
                    true,
                    "Bluetooth address of the iPhone that emitted the call.",
                ),
                f(
                    "remote_id",
                    FieldKind::String,
                    true,
                    "Raw caller phone number or platform identifier.",
                ),
                f(
                    "display_name",
                    FieldKind::String,
                    true,
                    "Resolved caller or contact name when available.",
                ),
                f(
                    "status",
                    FieldKind::String,
                    true,
                    "Normalized iAP2 call status.",
                ),
                f(
                    "direction",
                    FieldKind::String,
                    true,
                    "Normalized incoming or outgoing direction.",
                ),
                f("label", FieldKind::String, false, "Contact number label."),
                f(
                    "service",
                    FieldKind::String,
                    false,
                    "Telephony or FaceTime service kind.",
                ),
                f(
                    "started_at_unix_s",
                    FieldKind::I64,
                    false,
                    "Call start time in Unix seconds.",
                ),
            ],
            r#"{"call_id":"call-1","device":"AA:BB:CC:DD:EE:FF","remote_id":"+15555550100","display_name":"Test Caller","status":"active","direction":"incoming","service":"telephony"}"#,
            "Complete merged snapshot for a changed iPhone call.",
        ),
        "Broadcast after a sparse iAP2 call delta is merged into an existing call.",
    ),
    event(
        "phone.call.ended",
        Family::Phone,
        "phone.call.ended",
        &[],
        payload(
            &[
                f("call_id", FieldKind::String, true, "Stable iAP2 CallUUID."),
                f(
                    "device",
                    FieldKind::String,
                    true,
                    "Bluetooth address of the iPhone that emitted the call.",
                ),
                f(
                    "reason",
                    FieldKind::String,
                    true,
                    "Normalized reason the call left the active set.",
                ),
            ],
            r#"{"call_id":"call-1","device":"AA:BB:CC:DD:EE:FF","reason":"missed"}"#,
            "Call lifecycle end event.",
        ),
        "Broadcast when iOS reports the call disconnected or the iAP2 link closes.",
    ),
    event(
        "spotify.auth.status",
        Family::Spotify,
        "spotify.auth.status",
        &[],
        payload(
            &[
                f(
                    "authenticated",
                    FieldKind::Bool,
                    true,
                    "Spotify auth state.",
                ),
                f(
                    "skipped",
                    FieldKind::Bool,
                    false,
                    "Whether auth was skipped.",
                ),
            ],
            r#"{"authenticated":true,"skipped":false}"#,
            "Spotify auth state event.",
        ),
        "Consumed by the UI auth gate.",
    ),
    event(
        "spotify.auth.completed",
        Family::Spotify,
        "spotify.auth.completed",
        &[],
        payload(
            &[
                f(
                    "authenticated",
                    FieldKind::Bool,
                    true,
                    "Spotify auth state.",
                ),
                f(
                    "skipped",
                    FieldKind::Bool,
                    false,
                    "Whether auth was skipped.",
                ),
            ],
            r#"{"authenticated":true,"skipped":false}"#,
            "Spotify auth completed event.",
        ),
        "Consumed by the UI auth gate.",
    ),
    event(
        "ambient_light_update",
        Family::Device,
        "ambient_light_update",
        &[],
        payload(
            &[
                f(
                    "value",
                    FieldKind::U32,
                    true,
                    "Raw ambient light sensor value.",
                ),
                f(
                    "normalized_value",
                    FieldKind::U32,
                    true,
                    "Stock-compatible ambient darkness value from 0 to 100.",
                ),
            ],
            r#"{"value":123,"normalized_value":68}"#,
            "Ambient light reading event.",
        ),
        "The daemon emits the raw sensor reading and stock-compatible darkness value for the UI.",
    ),
    event(
        "wind_level",
        Family::Audio,
        "wind_level",
        &[],
        payload(
            &[
                f(
                    "level",
                    FieldKind::U8,
                    true,
                    "Stock-compatible wind interference level from 0 to 4.",
                ),
                f(
                    "stat",
                    FieldKind::F64,
                    true,
                    "Smoothed wind interference score from 0 to 100.",
                ),
            ],
            r#"{"level":3,"stat":72.5}"#,
            "Microphone wind interference level event.",
        ),
        "The UI warns when the level crosses from below 3 to level 3 or higher.",
    ),
    event(
        "daemon.ready",
        Family::BtOnly,
        "daemon.ready",
        &[],
        EMPTY_PAYLOAD,
        "BT-only daemon readiness event sent repeatedly until app.ready.",
    ),
    event(
        "daemon.heartbeat",
        Family::BtOnly,
        "daemon.heartbeat",
        &[],
        payload(
            &[f(
                "timestamp",
                FieldKind::U64,
                true,
                "Unix timestamp millis.",
            )],
            r#"{"timestamp":1713000000000}"#,
            "BT heartbeat event.",
        ),
        "Periodic daemon heartbeat over iAP2/BT.",
    ),
    event(
        "chunk.retransmit_request",
        Family::BtOnly,
        "chunk.retransmit_request",
        &[],
        payload(
            &[
                f(
                    "message_id",
                    FieldKind::String,
                    true,
                    "UUID of the chunked message.",
                ),
                f(
                    "chunk_idx",
                    FieldKind::U16,
                    true,
                    "Zero-based chunk index to retransmit.",
                ),
            ],
            r#"{"message_id":"550e8400-e29b-41d4-a716-446655440000","chunk_idx":2}"#,
            "Chunk retransmission request.",
        ),
        "Sent when daemon detects a chunk CRC mismatch.",
    ),
    event(
        "audio.recording.started",
        Family::BtOnly,
        "audio.recording.started",
        &[],
        payload(
            &[
                fs(
                    "sample_rate",
                    "sampleRate",
                    FieldKind::U32,
                    true,
                    "Sample rate. Current iAP2/SPP runtime uses sampleRate; msgpack tests expect sample_rate.",
                ),
                f("channels", FieldKind::U8, true, "Channel count."),
                fs(
                    "frame_ms",
                    "frameMs",
                    FieldKind::U16,
                    true,
                    "Frame duration. Current runtime uses frameMs; tests expect frame_ms.",
                ),
            ],
            r#"{"sample_rate":16000,"channels":1,"frame_ms":60}"#,
            "Audio recording lifecycle start.",
        ),
        "BT-only audio stream started event.",
    ),
    event(
        "audio.data",
        Family::BtOnly,
        "audio.data",
        &[],
        payload(
            &[
                f("seq", FieldKind::U64, true, "Monotonic frame sequence."),
                f("opus", FieldKind::BytesBase64, true, "Base64 Opus frame."),
                f("ts", FieldKind::U64, true, "Unix timestamp millis."),
            ],
            r#"{"seq":42,"opus":"qrvM3Q==","ts":1713000000000}"#,
            "Audio data frame.",
        ),
        "BT-only Opus audio frame event.",
    ),
    event(
        "audio.recording.stopped",
        Family::BtOnly,
        "audio.recording.stopped",
        &[],
        payload(
            &[
                f("reason", FieldKind::String, true, "Stop reason."),
                fs(
                    "total_frames",
                    "totalFrames",
                    FieldKind::U64,
                    true,
                    "Total frames captured. Current runtime uses totalFrames; tests expect total_frames.",
                ),
            ],
            r#"{"reason":"stopped","total_frames":128}"#,
            "Audio recording lifecycle stop.",
        ),
        "BT-only audio stream stopped event.",
    ),
    event(
        "keepalive",
        Family::BtOnly,
        "keepalive",
        &[],
        payload(
            &[f(
                "timestamp",
                FieldKind::F64,
                true,
                "Phone timestamp seconds.",
            )],
            r#"{"timestamp":1713000000.0}"#,
            "Companion keepalive event.",
        ),
        "iOS sends this when entering background; daemon currently treats it as generic event.",
    ),
];

pub const CSM_INVENTORY: &[Csm] = &[
    csm(
        "RequestAuthenticationCertificate",
        0xAA00,
        CsmDirection::ReceivedByAccessory,
        &[],
        "Device asks the accessory for its MFi authentication certificate.",
    ),
    csm(
        "AuthenticationCertificate",
        0xAA01,
        CsmDirection::SentByAccessory,
        &[csm_param(
            "cert",
            0,
            CsmFieldKind::Bytes,
            true,
            "X.509 DER certificate read from the MFi coprocessor.",
        )],
        "Accessory returns its MFi authentication certificate.",
    ),
    csm(
        "RequestAuthenticationChallengeResponse",
        0xAA02,
        CsmDirection::ReceivedByAccessory,
        &[csm_param(
            "challenge",
            0,
            CsmFieldKind::Bytes,
            true,
            "Challenge bytes the accessory signs with the MFi coprocessor.",
        )],
        "Device asks the accessory to sign an authentication challenge.",
    ),
    csm(
        "AuthenticationResponse",
        0xAA03,
        CsmDirection::SentByAccessory,
        &[csm_param(
            "response",
            0,
            CsmFieldKind::Bytes,
            true,
            "Signed challenge response returned by the MFi coprocessor.",
        )],
        "Accessory returns the signed MFi challenge response.",
    ),
    csm(
        "AuthenticationFailed",
        0xAA04,
        CsmDirection::ReceivedByAccessory,
        &[],
        "Device reports that MFi authentication failed.",
    ),
    csm(
        "AuthenticationSucceeded",
        0xAA05,
        CsmDirection::ReceivedByAccessory,
        &[],
        "Device reports that MFi authentication succeeded.",
    ),
    csm(
        "StartIdentification",
        0x1D00,
        CsmDirection::ReceivedByAccessory,
        &[],
        "Device starts the iAP2 identification exchange.",
    ),
    csm(
        "IdentificationAccepted",
        0x1D02,
        CsmDirection::ReceivedByAccessory,
        &[],
        "Device accepts the accessory's identification information.",
    ),
    csm(
        "DeviceInformationUpdate",
        0x4E09,
        CsmDirection::ReceivedByAccessory,
        &[csm_param(
            "device_name",
            0,
            CsmFieldKind::String,
            true,
            "User-visible device name.",
        )],
        "Device pushes its user-visible name after subscription.",
    ),
    csm(
        "DeviceLanguageUpdate",
        0x4E0A,
        CsmDirection::ReceivedByAccessory,
        &[csm_param(
            "language",
            0,
            CsmFieldKind::String,
            true,
            "ISO 639 language code.",
        )],
        "Device pushes its current language after subscription.",
    ),
    csm(
        "DeviceTimeUpdate",
        0x4E0B,
        CsmDirection::ReceivedByAccessory,
        &[
            csm_param(
                "seconds_since_reference_date",
                0,
                CsmFieldKind::I64,
                true,
                "Unix-epoch seconds.",
            ),
            csm_param(
                "tz_offset_minutes",
                1,
                CsmFieldKind::I16,
                true,
                "Signed timezone offset from GMT in minutes.",
            ),
            csm_param(
                "dst_offset_minutes",
                2,
                CsmFieldKind::I8,
                true,
                "Signed daylight-saving offset in minutes.",
            ),
        ],
        "Device pushes wall-clock and timezone-offset state after subscription.",
    ),
    csm(
        "DeviceUUIDUpdate",
        0x4E0C,
        CsmDirection::ReceivedByAccessory,
        &[csm_param(
            "uuid",
            0,
            CsmFieldKind::String,
            true,
            "Stable per-device UUID string.",
        )],
        "Device pushes its stable UUID after subscription.",
    ),
];

pub fn inventory(lib_src: &str) -> Result<Inventory> {
    let mut wire_enums = HashMap::new();
    let mut enums = HashMap::new();
    let mut markers: HashMap<String, MarkerSet> = HashMap::new();
    let mut typed_requests: Vec<TypedRequest> = Vec::new();
    let mut uuid_field_names: BTreeSet<String> = BTreeSet::new();

    for entry in walkdir::WalkDir::new(lib_src) {
        let entry = entry.context("walk lib_src")?;
        let path = entry.path();
        if !entry.file_type().is_file() {
            continue;
        }
        if path.extension().and_then(|s| s.to_str()) != Some("rs") {
            continue;
        }
        let src =
            std::fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
        let parsed = match syn::parse_file(&src) {
            Ok(p) => p,
            Err(e) => {
                eprintln!(
                    "    warning: dispatch: failed to parse {}: {e}",
                    path.display()
                );
                continue;
            }
        };
        walk_items(
            &parsed.items,
            &mut wire_enums,
            &mut enums,
            &mut markers,
            &mut typed_requests,
            &mut uuid_field_names,
        );
    }

    Ok(Inventory {
        wire_enums,
        enums,
        markers,
        typed_requests,
        methods: METHOD_INVENTORY,
        events: EVENT_INVENTORY,
        csms: CSM_INVENTORY,
        uuid_field_names,
    })
}

fn walk_items(
    items: &[Item],
    wire_enums: &mut HashMap<String, EnumDef>,
    enums: &mut HashMap<String, EnumDef>,
    markers: &mut HashMap<String, MarkerSet>,
    typed_requests: &mut Vec<TypedRequest>,
    uuid_field_names: &mut BTreeSet<String>,
) {
    for item in items {
        match item {
            Item::Enum(en) => {
                // Daemon-internal error enums (thiserror::Error) are not part
                // of the wire schema; skip them so they don't leak into the
                // generated language bindings. Swift in particular cannot encode
                // their `u8` / `std::io::Error` variant payloads.
                if has_derive(&en.attrs, "Error") && !has_derive(&en.attrs, "Serialize") {
                    continue;
                }
                let def = collect_enum(en);
                let name = def.name.clone();
                if matches!(
                    name.as_str(),
                    BRIDGE_TO_GATEWAY | GATEWAY_TO_BRIDGE | BRIDGE_TO_CLIENT | CLIENT_TO_BRIDGE
                ) {
                    wire_enums.insert(name.clone(), def);
                } else {
                    enums.insert(name.clone(), def);
                }
                // Standalone marker derives can appear on enums too
                // (e.g. `ForwardMessage`).
                for (kind, dir) in standalone_markers(&en.attrs) {
                    markers
                        .entry(name.clone())
                        .or_default()
                        .entries
                        .push((kind, dir));
                }
                // BridgeEnum-derived enums infer their parent-level marker from
                // per-variant `#[bridge_*]` tags. Direction comes from the parent
                // ident prefix.
                if has_derive(&en.attrs, "BridgeEnum")
                    && let Some(direction) = Direction::from_parent_ident(&name)
                {
                    let variants: Vec<&Variant> = en.variants.iter().collect();
                    for kind in infer_bridge_enum_markers(&variants) {
                        markers
                            .entry(name.clone())
                            .or_default()
                            .entries
                            .push((kind, direction));
                    }
                }
            }
            Item::Struct(s) => {
                let name = s.ident.to_string();
                for (kind, dir) in standalone_markers(&s.attrs) {
                    markers
                        .entry(name.clone())
                        .or_default()
                        .entries
                        .push((kind, dir));
                }
                if has_derive(&s.attrs, "WireRequest")
                    && let Some(req) = parse_wire_request_attr(s)
                {
                    typed_requests.push(req);
                }
                collect_uuid_field_names(s, uuid_field_names);
            }
            Item::Mod(m) => {
                if let Some((_, sub_items)) = &m.content {
                    walk_items(
                        sub_items,
                        wire_enums,
                        enums,
                        markers,
                        typed_requests,
                        uuid_field_names,
                    );
                }
            }
            _ => {}
        }
    }
}

/// Returns the markers declared via standalone derives on this item:
/// `WireEvent`, `WireCommand`, `WireUnicast`, each paired with one or
/// more directions read from the `#[wire(<Direction>, ...)]` attribute
/// on the same item.
fn standalone_markers(attrs: &[Attribute]) -> Vec<(MarkerKind, Direction)> {
    let mut kinds: Vec<MarkerKind> = Vec::new();
    for attr in attrs {
        if !attr.path().is_ident("derive") {
            continue;
        }
        let _ = attr.parse_nested_meta(|meta| {
            if let Some(seg) = meta.path.segments.last() {
                match seg.ident.to_string().as_str() {
                    "WireEvent" => kinds.push(MarkerKind::Event),
                    "WireCommand" => kinds.push(MarkerKind::Command),
                    "WireUnicast" => kinds.push(MarkerKind::Unicast),
                    _ => {}
                }
            }
            Ok(())
        });
    }
    if kinds.is_empty() {
        return Vec::new();
    }
    let directions = parse_wire_directions(attrs);
    kinds
        .into_iter()
        .flat_map(|kind| directions.iter().map(move |dir| (kind, *dir)))
        .collect()
}

fn parse_wire_directions(attrs: &[Attribute]) -> Vec<Direction> {
    let mut directions = Vec::new();
    for attr in attrs {
        if !attr.path().is_ident("wire") {
            continue;
        }
        let _ = attr.parse_nested_meta(|meta| {
            if let Some(seg) = meta.path.segments.last()
                && let Some(dir) = Direction::parse(&seg.ident.to_string())
            {
                directions.push(dir);
            }
            Ok(())
        });
    }
    directions
}

fn has_derive(attrs: &[Attribute], name: &str) -> bool {
    for attr in attrs {
        if !attr.path().is_ident("derive") {
            continue;
        }
        let mut found = false;
        let _ = attr.parse_nested_meta(|meta| {
            if let Some(seg) = meta.path.segments.last()
                && seg.ident == name
            {
                found = true;
            }
            Ok(())
        });
        if found {
            return true;
        }
    }
    false
}

/// For an enum with `#[derive(BridgeEnum)]`, infer the parent-level
/// marker traits from the per-variant `#[bridge_*]` tags. A variant
/// tagged `#[bridge_event]` contributes the Event marker;
/// `#[bridge_command]` contributes Command. Request and Response tags
/// don't contribute parent-level markers (typed requests route through
/// `WireRequest` on the request payload type; responses go through
/// `respond_to` and don't need a marker).
fn infer_bridge_enum_markers(variants: &[&Variant]) -> Vec<MarkerKind> {
    let mut has_event = false;
    let mut has_command = false;
    for v in variants {
        for attr in &v.attrs {
            if attr.path().is_ident("bridge_event") {
                has_event = true;
            } else if attr.path().is_ident("bridge_command") {
                has_command = true;
            }
        }
    }
    let mut out = Vec::new();
    if has_event {
        out.push(MarkerKind::Event);
    }
    if has_command {
        out.push(MarkerKind::Command);
    }
    out
}

/// Parse a `#[wire_request(...)]` attribute off a struct decorated with
/// `#[derive(WireRequest)]`. Format:
///
/// ```text
/// direction = <Ident>,
/// surface = <Ident>,
/// request_variant = <Ident>,
/// response = <TypePath>,
/// response_variant = <Ident>,
/// [error = <TypePath>,
///  error_variant = <Ident>,]
/// ```
fn parse_wire_request_attr(s: &ItemStruct) -> Option<TypedRequest> {
    let attr = s.attrs.iter().find(|a| a.path().is_ident("wire_request"))?;
    let mut direction: Option<Direction> = None;
    let mut surface: Option<String> = None;
    let mut request_variant: Option<String> = None;
    let mut response: Option<String> = None;
    let mut response_variant: Option<String> = None;
    let mut error: Option<String> = None;
    let mut error_variant: Option<String> = None;

    let _ = attr.parse_nested_meta(|meta| {
        if meta.path.is_ident("direction") {
            let id: syn::Ident = meta.value()?.parse()?;
            direction = Direction::parse(&id.to_string());
        } else if meta.path.is_ident("surface") {
            let v: syn::Path = meta.value()?.parse()?;
            surface = v.segments.last().map(|s| s.ident.to_string());
        } else if meta.path.is_ident("request_variant") {
            let v: syn::Ident = meta.value()?.parse()?;
            request_variant = Some(v.to_string());
        } else if meta.path.is_ident("response") {
            let v: syn::Path = meta.value()?.parse()?;
            response = v.segments.last().map(|s| s.ident.to_string());
        } else if meta.path.is_ident("response_variant") {
            let v: syn::Ident = meta.value()?.parse()?;
            response_variant = Some(v.to_string());
        } else if meta.path.is_ident("error") {
            let v: syn::Path = meta.value()?.parse()?;
            error = v.segments.last().map(|s| s.ident.to_string());
        } else if meta.path.is_ident("error_variant") {
            let v: syn::Ident = meta.value()?.parse()?;
            error_variant = Some(v.to_string());
        } else {
            return Err(meta.error("unknown key"));
        }
        Ok(())
    });

    let request_takes_payload = !matches!(s.fields, Fields::Unit);
    Some(TypedRequest {
        request: s.ident.to_string(),
        direction: direction?,
        surface: surface?,
        request_variant: request_variant?,
        request_takes_payload,
        response: response?,
        response_variant: response_variant?,
        error,
        error_variant,
    })
}

fn collect_enum(en: &ItemEnum) -> EnumDef {
    let variants = en
        .variants
        .iter()
        .map(|v| WireVariant {
            name: v.ident.to_string(),
            payload: variant_single_payload(&v.fields),
            is_struct: matches!(v.fields, Fields::Named(_)),
            tag: variant_tag(&v.attrs),
        })
        .collect();
    let tag_field = serde_tag_field(&en.attrs).unwrap_or_else(|| "type".to_string());
    EnumDef {
        name: en.ident.to_string(),
        variants,
        tag_field,
    }
}

fn variant_tag(attrs: &[Attribute]) -> Option<VariantTag> {
    for attr in attrs {
        let path = attr.path();
        if path.is_ident("bridge_event") {
            return Some(VariantTag::Event);
        }
        if path.is_ident("bridge_command") {
            return Some(VariantTag::Command);
        }
        if path.is_ident("bridge_request") {
            return Some(VariantTag::Request);
        }
        if path.is_ident("bridge_response") {
            return Some(VariantTag::Response);
        }
    }
    None
}

fn serde_tag_field(attrs: &[syn::Attribute]) -> Option<String> {
    for attr in attrs {
        if !attr.path().is_ident("serde") {
            continue;
        }
        let Ok(nested) = attr
            .parse_args_with(syn::punctuated::Punctuated::<Meta, syn::Token![,]>::parse_terminated)
        else {
            continue;
        };
        for meta in nested {
            if let Meta::NameValue(nv) = meta
                && nv.path.is_ident("tag")
                && let syn::Expr::Lit(lit) = nv.value
                && let syn::Lit::Str(s) = lit.lit
            {
                return Some(s.value());
            }
        }
    }
    None
}

fn variant_single_payload(fields: &Fields) -> Option<PayloadType> {
    match fields {
        Fields::Unit => None,
        Fields::Unnamed(unnamed) if unnamed.unnamed.len() == 1 => {
            Some(payload_type(&unnamed.unnamed[0].ty))
        }
        _ => None,
    }
}

/// Walk a struct's named fields and add the camelCase form of every
/// `Uuid`-typed field to `out`. Wrappers like `Option<Uuid>` are
/// recognized; anything else is skipped.
fn collect_uuid_field_names(s: &ItemStruct, out: &mut BTreeSet<String>) {
    let Fields::Named(named) = &s.fields else {
        return;
    };
    for field in &named.named {
        let Some(ident) = &field.ident else { continue };
        if !is_uuid_type(&field.ty) {
            continue;
        }
        out.insert(snake_to_camel(&ident.to_string()));
    }
}

fn is_uuid_type(ty: &Type) -> bool {
    let Type::Path(p) = ty else { return false };
    let Some(seg) = p.path.segments.last() else {
        return false;
    };
    let name = seg.ident.to_string();
    if name == "Uuid" {
        return true;
    }
    if name == "Option"
        && let PathArguments::AngleBracketed(args) = &seg.arguments
        && let Some(GenericArgument::Type(inner)) = args.args.first()
    {
        return is_uuid_type(inner);
    }
    false
}

fn payload_type(ty: &Type) -> PayloadType {
    let Type::Path(p) = ty else {
        return PayloadType::Named(quote::ToTokens::to_token_stream(ty).to_string());
    };
    let Some(seg) = p.path.segments.last() else {
        return PayloadType::Named("_".to_string());
    };
    let name = seg.ident.to_string();
    if name == "Box"
        && let PathArguments::AngleBracketed(args) = &seg.arguments
        && let Some(GenericArgument::Type(inner)) = args.args.first()
    {
        return payload_type(inner);
    }
    if name == "Vec"
        && let PathArguments::AngleBracketed(args) = &seg.arguments
        && let Some(GenericArgument::Type(Type::Path(inner))) = args.args.first()
        && inner.path.segments.last().is_some_and(|s| s.ident == "u8")
    {
        return PayloadType::Bytes;
    }
    if name == "Value" {
        return PayloadType::JsonValue;
    }
    if name == "String" {
        return PayloadType::StringScalar;
    }
    PayloadType::Named(name)
}
