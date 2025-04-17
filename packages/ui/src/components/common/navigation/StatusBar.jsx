import { useState, useEffect } from "react";
import { BatteryIcon, BluetoothIcon, WifiMaxIcon, WifiHighIcon, WifiLowIcon, WifiOffIcon } from "../../common/icons";
import { useSettings } from "../../../contexts/SettingsContext";
import { useWiFiNetworks } from "../../../hooks/useWiFiNetworks";
import { useBluetooth } from "../../../hooks/useNocturned";
import { useConnector } from "../../../contexts/ConnectorContext";
import { networkAwareRequest } from '../../../utils/networkAwareRequest';

let cachedTimezone = null;

export default function StatusBar() {
  const [currentTime, setCurrentTime] = useState("");
  const [isFourDigits, setIsFourDigits] = useState(false);
  const [isBluetoothConnected, setIsBluetoothConnected] = useState(true);
  const [batteryPercentage, setBatteryPercentage] = useState(80);
  const [timezone, setTimezone] = useState(null);
  const { settings } = useSettings();
  const { currentNetwork, availableNetworks } = useWiFiNetworks();
  const { lastConnectedDevice, connectedDevices } = useBluetooth();
  const { isConnectorAvailable } = useConnector();

  useEffect(() => {
    const fetchTimezone = async () => {
      if (cachedTimezone) {
        setTimezone(cachedTimezone);
        return;
      }

      try {
        const response = await networkAwareRequest(
          () => fetch("https://api.usenocturne.com/v1/timezone")
        );
        
        if (!response.ok) {
          console.error("Failed to fetch timezone from API");
          return;
        }

        const data = await response.json();
        if (data.timezone) {
          cachedTimezone = data.timezone;
          setTimezone(data.timezone);
          console.log("Timezone set to:", data.timezone);
        }
      } catch (error) {
        console.error("Error fetching timezone:", error);
      }
    };

    fetchTimezone();
  }, []);

  const getWiFiIcon = () => {
    if (!currentNetwork) return null;

    const scanNetwork = availableNetworks.find(n => n.ssid === currentNetwork.ssid);
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
    const updateTime = () => {
      const now = new Date();

      if (timezone) {
        try {
          const options = { timeZone: timezone, hour: 'numeric', minute: 'numeric', hour12: !settings.use24HourTime };
          const formatter = new Intl.DateTimeFormat('en-US', options);
          const timeString = formatter.format(now);

          let parts = timeString.split(':');
          let hours = parts[0];
          let minutes = parts[1];

          if (!settings.use24HourTime) {
            minutes = minutes.split(' ')[0];
          }

          setCurrentTime(`${hours}:${minutes}`);
          setIsFourDigits(hours.length >= 2);
          return;
        } catch (error) {
          console.error("Error formatting time with timezone:", error);
        }
      }

      let hours;
      if (settings.use24HourTime) {
        hours = now.getHours().toString().padStart(2, "0");
        setIsFourDigits(true);
      } else {
        hours = now.getHours() % 12 || 12;
        setIsFourDigits(hours >= 10);
      }

      const minutes = now.getMinutes().toString().padStart(2, "0");
      const timeString = `${hours}:${minutes}`;
      setCurrentTime(timeString);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);

    const handleTimeFormatChange = () => {
      updateTime();
    };

    window.addEventListener("timeFormatChanged", handleTimeFormatChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener("timeFormatChanged", handleTimeFormatChange);
    };
  }, [settings.use24HourTime, timezone]);

  useEffect(() => {
    let deviceAddress = null;

    if (lastConnectedDevice && lastConnectedDevice.address) {
      deviceAddress = lastConnectedDevice.address;
    } else if (connectedDevices && connectedDevices.length > 0) {
      deviceAddress = connectedDevices[0].address;
    }

  }, [lastConnectedDevice, connectedDevices]);

  const shouldRenderStatusBar = isBluetoothConnected || (isConnectorAvailable && currentNetwork);
  if (!shouldRenderStatusBar) return null;

  const showBluetoothInfo = isBluetoothConnected && (!isConnectorAvailable || !currentNetwork);

  return (
    <div
      className={`flex justify-between w-full mb-6 pr-10 ${isFourDigits ? "pl-0.5" : "pl-2"
        } items-start`}
    >
      <div
        className="text-[26px] font-[580] text-white tracking-tight leading-none"
        style={{ margin: 0, padding: 0, marginTop: "-1px" }}
      >
        {currentTime}
      </div>
      <div className="flex gap-2.5 h-10" style={{ marginTop: "-10px" }}>
        {currentNetwork && isConnectorAvailable ? (
          getWiFiIcon()
        ) : (
          showBluetoothInfo && (
            <BluetoothIcon
              className="w-8 h-10 text-white"
              style={{
                margin: 0,
                padding: 0,
                display: "block",
                transform: "translateY(-10px)",
              }}
            />
          )
        )}
      </div>
    </div>
  );
}
