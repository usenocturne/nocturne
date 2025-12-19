import React, { useState, useEffect } from "react";
import { sendNocturneWsRequest } from "../../hooks/useNocturned";

export default function About() {
  const [deviceInfo, setDeviceInfo] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchDeviceInfo = async () => {
      try {
        const response = await sendNocturneWsRequest("device.info", {});
        setDeviceInfo(response);
      } catch (error) {
        console.error("Failed to fetch device info:", error);
        setDeviceInfo(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDeviceInfo();
  }, []);

  return (
    <div className="space-y-4">
      <div className="bg-white/10 rounded-xl p-5 border border-white/10">
        <p className="text-[24px] font-[560] text-white/40 tracking-tight mb-1">
          Device
        </p>
        <p className="text-[28px] font-[580] text-white tracking-tight">
          {isLoading ? "Loading..." : deviceInfo?.device || "Unknown"}
        </p>
      </div>

      <div className="bg-white/10 rounded-xl p-5 border border-white/10">
        <p className="text-[24px] font-[560] text-white/40 tracking-tight mb-1">
          Version
        </p>
        <p className="text-[28px] font-[580] text-white tracking-tight">
          {isLoading ? "Loading..." : deviceInfo?.version ? `v${deviceInfo.version}` : "Unknown"}
        </p>
      </div>

      <div className="bg-white/10 rounded-xl p-5 border border-white/10">
        <p className="text-[24px] font-[560] text-white/40 tracking-tight mb-1">
          Serial Number
        </p>
        <p className="text-[28px] font-[580] text-white tracking-tight">
          {isLoading ? "Loading..." : deviceInfo?.serialNumber || "Unknown"}
        </p>
      </div>
    </div>
  );
}
