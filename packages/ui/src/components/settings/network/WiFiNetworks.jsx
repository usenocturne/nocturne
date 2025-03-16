import React, { useState, useEffect } from "react";
import {
  WifiMaxIcon,
  WifiHighIcon,
  WifiLowIcon,
  LockIcon,
  CheckIcon,
} from "../../common/icons";

const WiFiNetworks = () => {
  const [currentNetwork, setCurrentNetwork] = useState(null);
  const [myNetworks, setMyNetworks] = useState([]);
  const [otherNetworks, setOtherNetworks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [scanResults, setScanResults] = useState([]);

  useEffect(() => {
    setTimeout(() => {
      setCurrentNetwork({
        ssid: "Home Network",
        flags: ["WPA2", "[CURRENT]"],
      });

      setMyNetworks([
        {
          ssid: "Work Network",
          flags: ["WPA2"],
        },
      ]);

      setScanResults([
        {
          ssid: "Home Network",
          flags: ["WPA2"],
          signal: "-45",
        },
        {
          ssid: "Work Network",
          flags: ["WPA2"],
          signal: "-65",
        },
        {
          ssid: "Coffee Shop",
          flags: ["WPA2"],
          signal: "-75",
        },
        {
          ssid: "Guest Network",
          flags: [],
          signal: "-60",
        },
      ]);

      setOtherNetworks([
        {
          ssid: "Coffee Shop",
          flags: ["WPA2"],
          signal: "-75",
        },
        {
          ssid: "Guest Network",
          flags: [],
          signal: "-60",
        },
      ]);

      setLoading(false);
    }, 1000);
  }, []);

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
    return (
      flags.includes("WPA") || flags.includes("WEP") || flags.includes("WPA2")
    );
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
    if (otherNetworks.length === 0) return null;

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
                  {network.signal && getSignalIcon(network.signal)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderMyNetworks = () => {
    if (myNetworks.length === 0) return null;

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

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-12 bg-white/10 w-1/2 rounded-lg animate-pulse"></div>
        <div className="h-24 bg-white/10 rounded-xl animate-pulse"></div>
        <div className="h-12 bg-white/10 w-1/2 rounded-lg animate-pulse mt-8"></div>
        <div className="space-y-4">
          <div className="h-24 bg-white/10 rounded-xl animate-pulse"></div>
          <div className="h-24 bg-white/10 rounded-xl animate-pulse"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {renderCurrentNetwork()}

      <div className="space-y-8">
        {renderMyNetworks()}
        {renderOtherNetworks()}
      </div>
    </div>
  );
};

export default WiFiNetworks;
