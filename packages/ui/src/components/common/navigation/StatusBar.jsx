import { useState, useEffect } from "react";
import {
  BatteryIcon,
  BluetoothIcon,
  WifiMaxIcon,
  WifiHighIcon,
  WifiLowIcon,
  WifiOffIcon,
} from "../../common/icons";
import { useSettings } from "../../../contexts/SettingsContext";
import { useWiFiNetworks } from "../../../hooks/useWiFiNetworks";
import { useBluetooth } from "../../../hooks/useNocturned";
import { useConnector } from "../../../contexts/ConnectorContext";
import { useCurrentTime } from "../../../hooks/useCurrentTime";

let cachedTimezone = null;

export const getCachedTimezone = () => cachedTimezone;

export default function StatusBar() {
  const [isBluetoothConnected, setIsBluetoothConnected] = useState(true);
  const [batteryPercentage, setBatteryPercentage] = useState(80);
  const [rssi, setRssi] = useState(null);
  const { currentNetwork, availableNetworks } = useWiFiNetworks();
  const { lastConnectedDevice, connectedDevices } = useBluetooth();
  const { isConnectorAvailable } = useConnector();
  const { currentTime, isFourDigits } = useCurrentTime();

  const getWiFiIcon = () => {
    if (!currentNetwork) return null;

    const iconClass = "w-8 h-10 text-white";

    if (rssi !== null && !isNaN(rssi)) {
      if (rssi >= -50) return <WifiMaxIcon className={iconClass} />;
      if (rssi >= -70) return <WifiHighIcon className={iconClass} />;
      return <WifiLowIcon className={iconClass} />;
    }

    const scanNetwork = availableNetworks.find(
      (n) => n.ssid === currentNetwork.ssid,
    );
    if (!scanNetwork) return <WifiOffIcon className={iconClass} />;

    const signalStrength = parseInt(scanNetwork.signal, 10);

    if (signalStrength >= -50) return <WifiMaxIcon className={iconClass} />;
    if (signalStrength >= -70) return <WifiHighIcon className={iconClass} />;
    return <WifiLowIcon className={iconClass} />;
  };

  useEffect(() => {
    let deviceAddress = null;

    if (lastConnectedDevice && lastConnectedDevice.address) {
      deviceAddress = lastConnectedDevice.address;
    } else if (connectedDevices && connectedDevices.length > 0) {
      deviceAddress = connectedDevices[0].address;
    }
  }, [lastConnectedDevice, connectedDevices]);

  useEffect(() => {
    if (!isConnectorAvailable || !currentNetwork) return;

    const ENDPOINT = "http://172.16.42.1:20574/network/signal";

    const fetchSignal = async () => {
      try {
        const res = await fetch(ENDPOINT);
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.rssi) setRssi(parseInt(data.rssi, 10));
      } catch (err) {
        console.error("Failed to fetch Wi-Fi RSSI:", err);
      }
    };

    fetchSignal();
    const id = setInterval(fetchSignal, 15000);
    return () => clearInterval(id);
  }, [isConnectorAvailable, currentNetwork]);

  const shouldRenderStatusBar =
    isBluetoothConnected || (isConnectorAvailable && currentNetwork);
  if (!shouldRenderStatusBar) return null;

  const showBluetoothInfo =
    isBluetoothConnected && (!isConnectorAvailable || !currentNetwork);

  return (
    <div
      className={`flex justify-between w-full mb-6 pr-10 ${
        isFourDigits ? "pl-0.5" : "pl-2"
      } items-start`}
    >
      <div
        className="text-[26px] font-[580] text-white tracking-tight leading-none"
        style={{ margin: 0, padding: 0, marginTop: "-1px" }}
      >
        {currentTime}
      </div>
      <div className="flex gap-2.5 h-10" style={{ marginTop: "-10px" }}>
        {currentNetwork && isConnectorAvailable
          ? getWiFiIcon()
          : showBluetoothInfo && (
              <BluetoothIcon
                className="w-8 h-10 text-white"
                style={{
                  margin: 0,
                  padding: 0,
                  display: "block",
                  transform: "translateY(-10px)",
                }}
              />
            )}
      </div>
    </div>
  );
}
