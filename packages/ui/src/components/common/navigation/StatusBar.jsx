import { useState, useEffect } from "react";
import { SignalLowIcon, BatteryIcon } from "@/components/icons";

const StatusBar = () => {
  const [currentTime, setCurrentTime] = useState("");
  const batteryPercentage = 80;

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const hours = now.getHours() % 12 || 12;
      const minutes = now.getMinutes().toString().padStart(2, "0");
      const timeString = `${hours}:${minutes}`;
      setCurrentTime(timeString);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex justify-between w-full mb-6 pr-10 pl-2 items-start">
      <div
        className="text-[26px] font-[580] text-white tracking-tight leading-none"
        style={{ margin: 0, padding: 0, marginTop: "-1px" }}
      >
        {currentTime}
      </div>
      <div className="flex gap-2.5 h-10" style={{ marginTop: "-10px" }}>
        <SignalLowIcon
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
