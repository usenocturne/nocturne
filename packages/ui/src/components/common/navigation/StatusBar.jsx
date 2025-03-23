import { useState, useEffect } from "react";
import { BatteryIcon, BluetoothIcon, WifiMaxIcon, WifiHighIcon, WifiLowIcon, WifiOffIcon } from "../../common/icons";
import { useSettings } from "../../../contexts/SettingsContext";
import { useWiFiNetworks } from "../../../hooks/useWiFiNetworks";

export default function StatusBar() {
  const [currentTime, setCurrentTime] = useState("");
  const [isFourDigits, setIsFourDigits] = useState(false);
  const [isBluetoothConnected, setIsBluetoothConnected] = useState(true);
  const [batteryPercentage, setBatteryPercentage] = useState(80);
  const { settings } = useSettings();
  const { currentNetwork, availableNetworks } = useWiFiNetworks();

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
  }, [settings.use24HourTime]);

  if (!isBluetoothConnected) return null;

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
        {currentNetwork ? getWiFiIcon() : (
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
        {!currentNetwork && <BatteryIcon
          className="w-10 h-10"
          percentage={batteryPercentage}
          style={{
            margin: 0,
            padding: 0,
            display: "block",
            transform: "translateY(-10px)",
          }}
        />}
      </div>
    </div>
  );
}
