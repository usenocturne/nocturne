import React, { useState, useRef, useEffect } from "react";
import {
  WifiMaxIcon,
  WifiHighIcon,
  WifiLowIcon,
  LockIcon,
  CheckIcon,
} from "@/components/icons";

const WiFiNetworks = () => {
  const [currentNetwork, setCurrentNetwork] = useState(null);
  const [myNetworks, setMyNetworks] = useState([]);
  const [otherNetworks, setOtherNetworks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForgetDialog, setShowForgetDialog] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState(null);
  const [scanResults, setScanResults] = useState([]);
  const longPressTimer = useRef(null);
  const buttonPressInProgress = useRef(false);

  const updateNetworkLists = (scanData, savedNetworks, current) => {
    const filteredMyNetworks = savedNetworks.filter((myNetwork) =>
      scanData.some((scanNetwork) => scanNetwork.ssid === myNetwork.ssid)
    );
    setMyNetworks(filteredMyNetworks);

    const otherNetworksFiltered = scanData.filter(
      (network) =>
        !savedNetworks.some((myNetwork) => myNetwork.ssid === network.ssid) &&
        (!current || network.ssid !== current.ssid)
    );
    setOtherNetworks(otherNetworksFiltered);
  };

  const performScan = async (savedNetworks, current) => {
    try {
      const response = await fetch("https://10.13.0.164:20574/network/scan");
      if (!response.ok) {
        throw new Error("Failed to fetch other networks");
      }
      const data = await response.json();
      setScanResults(data);
      updateNetworkLists(data, savedNetworks, current);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    const fetchMyNetworks = async () => {
      try {
        const response = await fetch("https://10.13.0.164:20574/network/list");
        if (!response.ok) {
          throw new Error("Failed to fetch my networks");
        }
        const data = await response.json();

        const current = data.find((network) =>
          network.flags.includes("[CURRENT]")
        );
        const savedNetworks = data.filter(
          (network) => !network.flags.includes("[CURRENT]")
        );

        setCurrentNetwork(current);
        setMyNetworks(savedNetworks);

        performScan(savedNetworks, current);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchMyNetworks();
  }, []);

  useEffect(() => {
    if (!myNetworks || !currentNetwork) return;

    const intervalId = setInterval(
      () => performScan(myNetworks, currentNetwork),
      15000
    );
    return () => clearInterval(intervalId);
  }, [myNetworks, currentNetwork]);

  const getSignalIcon = (signal) => {
    const signalStrength = parseInt(signal);
    const iconClass = "w-[24px] h-[24px] text-white";

    if (signalStrength >= -50) {
      return <WifiMaxIcon className={iconClass} />;
    } else if (signalStrength >= -70) {
      return <WifiHighIcon className={iconClass} />;
    } else {
      return <WifiLowIcon className={iconClass} />;
    }
  };

  const hasPasswordSecurity = (flags) => {
    return flags.includes("WPA") || flags.includes("WEP");
  };

  const renderCurrentNetwork = () => {
    if (!currentNetwork) return null;

    const scanNetwork = scanResults.find(
      (scan) => scan.ssid === currentNetwork.ssid
    );
    const securityFlags = scanNetwork?.flags || currentNetwork.flags;

    return (
      <div className="mb-8">
        <div className="bg-white/10 rounded-xl p-6 select-none border border-white/10">
          <div className="flex justify-between items-center">
            <div className="min-w-0 flex-1">
              <h4 className="text-[28px] font-[580] text-white tracking-tight truncate pr-4">
                {currentNetwork.ssid}
              </h4>
            </div>
            <div className="flex items-center gap-3">
              <CheckIcon className="text-white w-[24px] h-[24px]" />
              {hasPasswordSecurity(securityFlags) && (
                <LockIcon className="text-white" size={24} />
              )}
              {scanNetwork && getSignalIcon(scanNetwork.signal)}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderOtherNetworks = () => {
    return (
      <div>
        <h3 className="text-[32px] font-[580] text-white tracking-tight">
          Other Networks
        </h3>

        <div className="space-y-4 pt-4">
          {otherNetworks.map((network) => (
            <div
              key={network.ssid}
              className="bg-white/10 rounded-xl p-6 select-none border border-white/10"
            >
              <div className="flex justify-between items-center">
                <div className="min-w-0 flex-1">
                  <h4 className="text-[28px] font-[580] text-white tracking-tight truncate pr-4">
                    {network.ssid}
                  </h4>
                </div>
                <div className="flex items-center gap-3">
                  {hasPasswordSecurity(network.flags) && (
                    <LockIcon className="text-white" size={24} />
                  )}
                  {getSignalIcon(network.signal)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderMyNetworks = () => {
    const networksInRange = myNetworks.filter((network) =>
      scanResults.some((scan) => scan.ssid === network.ssid)
    );

    if (networksInRange.length === 0) return null;

    return (
      <div>
        <h3 className="text-[32px] font-[580] text-white tracking-tight">
          My Networks
        </h3>

        <div className="space-y-4 pt-4">
          {networksInRange.map((network) => {
            const scanNetwork = scanResults.find(
              (scan) => scan.ssid === network.ssid
            );
            const securityFlags = scanNetwork?.flags || network.flags;

            return (
              <div
                key={network.ssid}
                className="bg-white/10 rounded-xl p-6 select-none border border-white/10"
              >
                <div className="flex justify-between items-center">
                  <div className="min-w-0 flex-1">
                    <h4 className="text-[28px] font-[580] text-white tracking-tight truncate pr-4">
                      {network.ssid}
                    </h4>
                  </div>
                  <div className="flex items-center gap-3">
                    {hasPasswordSecurity(securityFlags) && (
                      <LockIcon className="text-white" size={24} />
                    )}
                    {scanNetwork && getSignalIcon(scanNetwork.signal)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {renderCurrentNetwork()}

      <div className="space-y-8">
        {myNetworks.length > 0 && renderMyNetworks()}
        {otherNetworks.length > 0 && renderOtherNetworks()}
      </div>
    </div>
  );
};

export default WiFiNetworks;
