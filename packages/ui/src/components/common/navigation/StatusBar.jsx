import { useState, useEffect } from "react";
import {
  BatteryIcon,
  BluetoothIcon,
  MicrophoneOffIcon,
  USBIcon,
} from "../../common/icons";
import { useBluetooth } from "../../../hooks/useNocturned";
import { useCurrentTime } from "../../../hooks/useCurrentTime";
import { useSettings } from "../../../contexts/SettingsContext";

export default function StatusBar() {
  const [batteryPercentage, setBatteryPercentage] = useState(80);
  const { lastConnectedDevice, connectedDevices, devices } = useBluetooth();
  const { currentTime, isFourDigits } = useCurrentTime();
  const { settings, isMicLocked } = useSettings();
  const effectiveMicMuted = !!isMicLocked || (settings?.micMuted ?? false);

  const lastDeviceAddressLS =
    typeof localStorage !== "undefined"
      ? localStorage.getItem("lastConnectedBluetoothDevice")
      : null;

  const isBluetoothConnected =
    (Array.isArray(connectedDevices) &&
      connectedDevices.some((d) => d?.connected)) ||
    (Array.isArray(devices) && devices.some((d) => d?.connected)) ||
    Boolean(lastConnectedDevice) ||
    Boolean(lastDeviceAddressLS);

  useEffect(() => {
    let deviceAddress = null;

    if (lastConnectedDevice && lastConnectedDevice.address) {
      deviceAddress = lastConnectedDevice.address;
    } else if (connectedDevices && connectedDevices.length > 0) {
      deviceAddress = connectedDevices[0].address;
    }
  }, [lastConnectedDevice, connectedDevices]);

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
        {effectiveMicMuted && (
          <MicrophoneOffIcon
            className="w-7 h-10 text-white"
            style={{
              margin: 0,
              padding: 0,
              display: "block",
              transform: "translateY(-10px)",
            }}
          />
        )}
        {isBluetoothConnected ? (
          <BluetoothIcon
            className="w-8 h-10 text-white"
            style={{
              margin: 0,
              padding: 0,
              display: "block",
              transform: "translateY(-10px)",
            }}
          />
        ) : (
          <USBIcon
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
