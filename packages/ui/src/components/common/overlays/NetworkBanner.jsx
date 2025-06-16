import React, { useState, useEffect } from "react";
import { XIcon, WifiOffIcon } from "../icons";
import { useBluetooth } from "../../../hooks/useNocturned";

const NetworkBanner = ({ visible, onClose }) => {
  const [isExiting, setIsExiting] = useState(false);
  const { attemptReconnect, stopRetrying } = useBluetooth();

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      onClose();
    }, 300);
  };

  useEffect(() => {
    if (visible) {
      setIsExiting(false);
    }
    
    return () => {
      if (!visible) {
        stopRetrying();
      }
    };
  }, [visible, attemptReconnect, stopRetrying]);

  if (!visible) return null;

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-[1000] bg-blue-500 transition-all duration-300 rounded-t-2xl ${
        isExiting
          ? "translate-y-[-100%] opacity-0"
          : "translate-y-0 opacity-100"
      }`}
    >
      <div className="max-w-screen-xl mx-auto px-8 py-4 flex items-center justify-between">
        <div className="flex items-center flex-grow">
          <WifiOffIcon className="w-6 h-6 text-white mr-3" />
          <p className="text-white text-[20px] font-[560] tracking-tight">
            Network connection lost. Ensure mobile hotspot is enabled.
          </p>
        </div>
        <button
          onClick={handleClose}
          className="bg-transparent border-none text-white/70 hover:text-white transition-colors ml-4"
        >
          <XIcon className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
};

export default NetworkBanner;
