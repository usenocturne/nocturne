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
  const { currentNetwork, availableNetworks } = useWiFiNetworks();
  const { lastConnectedDevice, connectedDevices } = useBluetooth();
  const { isConnectorAvailable } = useConnector();
  const { currentTime, isFourDigits } = useCurrentTime();

  const getWiFiIcon = () => {
    if (!currentNetwork) return null;

    const scanNetwork = availableNetworks.find(
      (n) => n.ssid === currentNetwork.ssid,
    );
    if (!scanNetwork) return <WifiOffIcon className="w-8 h-10 text-white" />;

    const signalStrength = parseInt(scanNetwork.signal);
    const iconClass = "w-8 h-10 text-white";

    if (signalStrength >= -50) {
      return <WifiMaxIcon className={iconClass} />;
    } else if (signalStrength >= -70) {
      return <WifiHighIcon className={iconClass} />;
    } else {
      return <WifiLowIcon className={iconClass} />;
    }
  };

  useEffect(() => {
    let deviceAddress = null;

    if (lastConnectedDevice && lastConnectedDevice.address) {
      deviceAddress = lastConnectedDevice.address;
    } else if (connectedDevices && connectedDevices.length > 0) {
      deviceAddress = connectedDevices[0].address;
    }
  }, [lastConnectedDevice, connectedDevices]);

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
