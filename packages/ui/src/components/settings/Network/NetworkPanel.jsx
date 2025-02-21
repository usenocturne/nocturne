import React, { useState, useRef, useEffect } from "react";
import { inter } from "../../../constants/fonts";
import { BluetoothIcon, NetworkIcon } from "@/components/icons";
import BluetoothDevices from "./BluetoothDevices";
import WiFiNetworks from "./WiFiNetworks";

const networkStructure = {
  wifi: {
    title: "Wi-Fi",
    icon: NetworkIcon,
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
}

const NetworkPanel = () => {
  const renderSettingItem = (item) => {
    if (item.component) {
      const Component = item.component;
      return <Component key={item.id} />;
    }
    switch (item.id) {
      case "wifi":
        return <WiFiNetworks key={item.id} />;
      case "bluetooth":
        return <BluetoothDevices key={item.id} />;
      default:
        return null;
    }
  }

  // TODO: Render buttons for submenu

  return;
};

export default NetworkPanel;
