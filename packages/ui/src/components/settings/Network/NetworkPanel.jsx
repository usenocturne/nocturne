import React from "react";
import {
  BluetoothIcon,
  WifiMaxIcon,
  ChevronRightIcon,
} from "@/components/icons";
import BluetoothDevices from "./BluetoothDevices";
import WiFiNetworks from "./WiFiNetworks";

const NetworkPanel = ({ navigateTo }) => {
  const networkStructure = {
    wifi: {
      title: "Wi-Fi",
      icon: WifiMaxIcon,
      items: [
        {
          id: "wifi",
        },
      ],
    },
    bluetooth: {
      title: "Bluetooth",
      icon: BluetoothIcon,
      items: [
        {
          id: "bluetooth",
        },
      ],
    },
  };

  return (
    <div className="space-y-4">
      {Object.entries(networkStructure).map(([key, section]) => (
        <button
          key={key}
          onClick={() => navigateTo(key)}
          className="flex items-center justify-between w-full p-4 bg-white/10 rounded-xl hover:bg-white/20 transition-colors border border-white/10"
        >
          <div className="flex items-center">
            <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center">
              <section.icon className="w-7 h-7 text-white" />
            </div>
            <span className="text-[32px] ml-4 font-[580] text-white tracking-tight">
              {section.title}
            </span>
          </div>
          <ChevronRightIcon className="w-8 h-8 text-white/60" />
        </button>
      ))}
    </div>
  );
};

export default NetworkPanel;
