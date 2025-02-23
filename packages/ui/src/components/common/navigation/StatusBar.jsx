import { useState, useEffect, useRef } from "react";
import { BatteryIcon, BluetoothIcon } from "@/components/icons";

let hasInitializedTimezone = false;

const StatusBar = () => {
  const [currentTime, setCurrentTime] = useState("");
  const [isFourDigits, setIsFourDigits] = useState(false);
  const [isBluetoothTethered, setIsBluetoothTethered] = useState(false);
  const [batteryPercentage, setBatteryPercentage] = useState(80);
  const [timezone, setTimezone] = useState(null);
  const batteryCheckIntervalRef = useRef(null);
  const mountedRef = useRef(false);

  const checkBatteryPercentage = async () => {
    const address = localStorage.getItem("connectedBluetoothAddress");
    if (!address || address === "undefined") return;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      const response = await fetch(
        `http://localhost:5000/bluetooth/info/${address}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
        }
      );

      clearTimeout(timeout);

      if (response.ok) {
        const deviceInfo = await response.json();
        if (deviceInfo?.batteryPercentage) {
          setBatteryPercentage(deviceInfo.batteryPercentage);
        }
      }
    } catch (error) {
      if (error.name === "AbortError") {
        console.error("Battery check request timed out after 1 minute");
      } else {
        console.error("Failed to fetch battery percentage:", error);
      }
    }
  };

  const getConnectedDeviceAddress = async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      const response = await fetch("http://localhost:5000/bluetooth/devices", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        const devices = await response.json();
        const connectedDevice = devices.find((device) => device.connected);
        if (connectedDevice?.address) {
          localStorage.setItem(
            "connectedBluetoothAddress",
            connectedDevice.address
          );
          return connectedDevice.address;
        }
      }
      return null;
    } catch (error) {
      if (error.name === "AbortError") {
        console.error("Device check request timed out after 1 minute");
      } else {
        console.error("Failed to check connected devices:", error);
      }
      return null;
    }
  };

  useEffect(() => {
    const fetchTimezone = async () => {
      if (hasInitializedTimezone) return;
      hasInitializedTimezone = true;

      try {
        const response = await fetch("https://api.usenocturne.com/v1/timezone");
        if (response.ok) {
          const data = await response.json();
          setTimezone(data.timezone);
        } else {
          console.error("Failed to fetch timezone");
        }
      } catch (error) {
        console.error("Error fetching timezone:", error);
      }
    };

    fetchTimezone();
  }, []);

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:5000/ws");

    getConnectedDeviceAddress().then((address) => {
      if (address) {
        setIsBluetoothTethered(true);
        checkBatteryPercentage();
        if (batteryCheckIntervalRef.current) {
          clearInterval(batteryCheckIntervalRef.current);
        }
        batteryCheckIntervalRef.current = setInterval(
          checkBatteryPercentage,
          60000
        );
      }
    });

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "bluetooth/connect") {
        if (data.address) {
          localStorage.setItem("connectedBluetoothAddress", data.address);
          setIsBluetoothTethered(true);
          window.dispatchEvent(
            new CustomEvent("bluetooth-device-connected", {
              detail: { address: data.address },
            })
          );
          checkBatteryPercentage();
          if (batteryCheckIntervalRef.current) {
            clearInterval(batteryCheckIntervalRef.current);
          }
          batteryCheckIntervalRef.current = setInterval(
            checkBatteryPercentage,
            60000
          );
        } else {
          getConnectedDeviceAddress().then((address) => {
            if (address) {
              setIsBluetoothTethered(true);
              window.dispatchEvent(
                new CustomEvent("bluetooth-device-connected", {
                  detail: { address },
                })
              );
              checkBatteryPercentage();
              if (batteryCheckIntervalRef.current) {
                clearInterval(batteryCheckIntervalRef.current);
              }
              batteryCheckIntervalRef.current = setInterval(
                checkBatteryPercentage,
                60000
              );
            }
          });
        }
      } else if (
        data.type === "bluetooth/network/disconnect" ||
        data.type === "bluetooth/disconnect"
      ) {
        setIsBluetoothTethered(false);
        setBatteryPercentage(80);

        if (batteryCheckIntervalRef.current) {
          clearInterval(batteryCheckIntervalRef.current);
          batteryCheckIntervalRef.current = null;
        }
      }
    };

    ws.onerror = () => {
      setIsBluetoothTethered(false);
      setBatteryPercentage(80);
      if (batteryCheckIntervalRef.current) {
        clearInterval(batteryCheckIntervalRef.current);
        batteryCheckIntervalRef.current = null;
      }
    };

    ws.onclose = () => {
      setIsBluetoothTethered(false);
      setBatteryPercentage(80);
      if (batteryCheckIntervalRef.current) {
        clearInterval(batteryCheckIntervalRef.current);
        batteryCheckIntervalRef.current = null;
      }
    };

    return () => {
      ws.close();
      if (batteryCheckIntervalRef.current) {
        clearInterval(batteryCheckIntervalRef.current);
        batteryCheckIntervalRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();

      const timeInZone = timezone
        ? new Date(now.toLocaleString("en-US", { timeZone: timezone }))
        : now;

      const use24Hour = localStorage.getItem("use24HourTime") === "true";

      let hours;
      if (use24Hour) {
        hours = timeInZone.getHours().toString().padStart(2, "0");
        setIsFourDigits(true);
      } else {
        hours = timeInZone.getHours() % 12 || 12;
        setIsFourDigits(hours >= 10);
      }

      const minutes = timeInZone.getMinutes().toString().padStart(2, "0");
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
  }, [timezone]);

  if (!isBluetoothTethered) return null;

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
        {/* TODO: use wifi icon (signal based on periodic scans) when using connector */}
        <BluetoothIcon
          className="w-8 h-10"
          style={{
            margin: 0,
            padding: 0,
            display: "block",
            transform: "translateY(-10px)",
          }}
        />
        <BatteryIcon
          className="w-10 h-10"
          percentage={batteryPercentage}
          style={{
            margin: 0,
            padding: 0,
            display: "block",
            transform: "translateY(-10px)",
          }}
        />
      </div>
    </div>
  );
};

export default StatusBar;
