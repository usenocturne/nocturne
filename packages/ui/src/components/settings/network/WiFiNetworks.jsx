import React, { useContext } from "react";
import {
  WifiMaxIcon,
  WifiHighIcon,
  WifiLowIcon,
  WifiOffIcon,
  LockIcon,
  CheckIcon,
  RefreshIcon,
} from "../../common/icons";
import { useWiFiNetworks } from "../../../hooks/useWiFiNetworks";
import { NetworkContext, ConnectorContext } from "../../../App";

const WiFiNetworks = () => {
  const { setSelectedNetwork } = useContext(NetworkContext);
  const { setShowConnectorModal } = useContext(ConnectorContext);
  const {
    currentNetwork,
    savedNetworks,
    availableNetworks,
    networkStatus,
    error,
    isInitialLoading,
    isScanning,
    isForgetting,
    isConnectorAvailable,
    scanNetworks,
    connectToSavedNetwork,
    forgetNetwork,
    hasPasswordSecurity,
  } = useWiFiNetworks();

  const getSignalIcon = (signal) => {
    if (!signal)
      return <WifiLowIcon className="w-[24px] h-[24px] text-white" />;

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

  const handleNetworkClick = (network) => {
    setSelectedNetwork(network);
  };

  const handleConnectToSavedNetwork = async (networkId) => {
    await connectToSavedNetwork(networkId);
  };

  const handleForgetNetwork = async (networkId, e) => {
    e.stopPropagation();
    await forgetNetwork(networkId);
  };

  const handleRefresh = () => {
    scanNetworks(false);
  };

  const renderCurrentNetwork = () => {
    if (!currentNetwork) return null;

    const scanNetwork = availableNetworks.find(
      (n) => n.ssid === currentNetwork.ssid
    );
    const inRange = !!scanNetwork;

    return (
      <div className="mb-8">
        <div className="bg-white/10 rounded-xl p-6 select-none border border-white/10">
          <div className="flex justify-between items-center">
            <div className="min-w-0 flex-1">
              <h4 className="text-[28px] font-[580] text-white tracking-tight truncate pr-4">
                {currentNetwork.ssid}
              </h4>
              {!networkStatus && (
                <p className="text-white/60 text-[20px]">Connecting...</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="text-green-500 flex items-center gap-1">
                <CheckIcon className="w-[20px] h-[20px]" />
                <span className="text-[18px]">Connected</span>
              </div>
              {hasPasswordSecurity(currentNetwork.flags) && (
                <LockIcon className="text-white" size={24} />
              )}
              {inRange ? (
                getSignalIcon(scanNetwork.signal)
              ) : (
                <WifiOffIcon className="w-[24px] h-[24px] text-white/60" />
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderMyNetworks = () => {
    if (!savedNetworks || savedNetworks.length === 0) return null;

    return (
      <div className="mb-8">
        <h3 className="text-[32px] font-[580] text-white tracking-tight mb-4">
          Saved Networks
        </h3>

        <div className="space-y-4">
          {savedNetworks.map((network) => {
            const scanNetwork = availableNetworks.find(
              (n) => n.ssid === network.ssid
            );
            const inRange = !!scanNetwork;

            return (
              <div
                key={network.networkId}
                onClick={() =>
                  inRange && handleConnectToSavedNetwork(network.networkId)
                }
                className={`bg-white/10 rounded-xl p-6 select-none border border-white/10 
                  ${inRange
                    ? "hover:bg-white/20 transition-colors"
                    : "opacity-70"
                  }`}
              >
                <div className="flex justify-between items-center">
                  <div className="min-w-0 flex-1">
                    <h4 className="text-[28px] font-[580] text-white tracking-tight truncate pr-4">
                      {network.ssid}
                    </h4>
                    {!inRange && (
                      <p className="text-white/60 text-[20px]">Out of Range</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {hasPasswordSecurity(network.flags) && (
                      <LockIcon className="text-white" size={24} />
                    )}
                    {inRange ? (
                      getSignalIcon(scanNetwork.signal)
                    ) : (
                      <WifiOffIcon className="w-[24px] h-[24px] text-white/60" />
                    )}
                    <button
                      onClick={(e) => handleForgetNetwork(network.networkId, e)}
                      className="text-white/60 hover:text-white text-[24px] transition-colors px-2 hover:bg-white/10 rounded"
                      disabled={isForgetting}
                    >
                      Forget
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderAvailableNetworks = () => {
    const otherNetworks = availableNetworks.filter((network) => {
      const isCurrentNetwork =
        currentNetwork && network.ssid === currentNetwork.ssid;
      const isSavedNetwork =
        savedNetworks &&
        savedNetworks.some((saved) => saved.ssid === network.ssid);
      return !isCurrentNetwork && !isSavedNetwork;
    });

    if (!otherNetworks || otherNetworks.length === 0) return null;

    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[32px] font-[580] text-white tracking-tight">
            Available Networks
          </h3>
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 text-white/60 hover:text-white transition-colors p-2 rounded-full hover:bg-white/10"
            disabled={isScanning}
            aria-label="Refresh networks"
          >
            <RefreshIcon
              className={`w-6 h-6 ${isScanning ? "animate-spin" : ""}`}
            />
          </button>
        </div>

        <div className="space-y-4">
          {otherNetworks.map((network) => (
            <div
              key={network.bssid || network.ssid}
              onClick={() => handleNetworkClick(network)}
              className="bg-white/10 rounded-xl p-6 select-none border border-white/10 hover:bg-white/20 transition-colors"
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

  if (!isConnectorAvailable) {
    return (
      <div className="w-full flex flex-col items-center justify-center">
        <WifiOffIcon className="w-12 h-12 text-white/80 mb-4" />
        <p className="text-[36px] font-[580] text-white tracking-tight text-center mb-2 w-full">
          Wi-Fi Unavailable
        </p>
        <p className="text-white/80 text-[28px] tracking-tight text-center w-full mb-6 px-0">
          Wi-Fi usage requires Nocturne Connector on a Raspberry Pi.
        </p>
        <button
          onClick={() => setShowConnectorModal(true)}
          className="bg-white/10 rounded-xl hover:bg-white/20 transition-colors border border-white/10 px-6 py-3"
        >
          <span className="text-[28px] font-[560] text-white tracking-tight">
            Learn More
          </span>
        </button>
      </div>
    );
  }

  if (isInitialLoading) {
    return (
      <div className="space-y-4">
        <div className="h-12 bg-white/10 w-1/3 rounded-lg animate-pulse"></div>
        <div className="h-24 bg-white/10 rounded-xl animate-pulse"></div>
        <div className="h-12 bg-white/10 w-1/3 rounded-lg animate-pulse mt-8"></div>
        <div className="space-y-4">
          <div className="h-24 bg-white/10 rounded-xl animate-pulse"></div>
          <div className="h-24 bg-white/10 rounded-xl animate-pulse"></div>
        </div>
      </div>
    );
  }

  const hasAnyNetworks =
    currentNetwork ||
    (savedNetworks && savedNetworks.length > 0) ||
    (availableNetworks && availableNetworks.length > 0);

  if (!hasAnyNetworks) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <WifiOffIcon className="w-12 h-12 text-white/40 mb-4" />
        <p className="text-white/60 text-[28px] mb-6">No networks found</p>
        <button
          onClick={() => scanNetworks(true)}
          className="bg-white/10 hover:bg-white/20 transition-colors rounded-xl px-6 py-3 text-[28px] font-[560] text-white flex items-center gap-2"
          disabled={isScanning}
        >
          <RefreshIcon
            className={`w-6 h-6 ${isScanning ? "animate-spin" : ""}`}
          />
          Scan for networks
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-900/40 border border-red-700/60 rounded-xl p-4 mb-4">
          <p className="text-white/80 text-[20px]">{error}</p>
          <button
            onClick={() => scanNetworks(false)}
            className="text-white/60 hover:text-white text-[18px] mt-2 underline transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {renderCurrentNetwork()}
      {renderMyNetworks()}
      {renderAvailableNetworks()}
    </div>
  );
};

export default WiFiNetworks;
