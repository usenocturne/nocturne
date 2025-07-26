import React, { useContext, useState, useRef } from "react";
import {
  WifiMaxIcon,
  WifiHighIcon,
  WifiLowIcon,
  WifiOffIcon,
  LockIcon,
  CheckIcon,
  RefreshIcon,
} from "../../common/icons";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  DialogBackdrop,
} from "@headlessui/react";
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
    isConnecting,
    isForgetting,
    isConnectorAvailable,
    scanNetworks,
    connectToNetwork,
    connectToSavedNetwork,
    forgetNetwork,
    hasPasswordSecurity,
  } = useWiFiNetworks();

  const longPressTimer = useRef(null);
  const [showForgetDialog, setShowForgetDialog] = useState(false);
  const [selectedNetworkId, setSelectedNetworkId] = useState(null);

  const handleCardPress = (networkId) => {
    longPressTimer.current = setTimeout(() => {
      setSelectedNetworkId(networkId);
      setShowForgetDialog(true);
    }, 800);
  };

  const handleCardRelease = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
  };

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

  const handleNetworkClick = async (network) => {
    setSelectedNetwork(network);

    if (hasPasswordSecurity(network.flags)) {
      return;
    }

    try {
      const success = await connectToNetwork(network);
      if (success) {
        setSelectedNetwork(null);
      }
    } catch (error) {
      console.error("Failed to auto-connect to open network:", error);
    }
  };

  const handleConnectToSavedNetwork = async (networkId) => {
    await connectToSavedNetwork(networkId);
  };

  const handleForgetNetwork = async (networkId, e) => {
    e.stopPropagation();
    await forgetNetwork(networkId);
  };

  const handleRefresh = () => {
    if (!isConnecting) {
      scanNetworks(false);
    }
  };

  const renderCurrentNetwork = () => {
    if (!currentNetwork) return null;

    const scanNetwork = availableNetworks.find(
      (n) => n.ssid === currentNetwork.ssid,
    );
    const inRange = !!scanNetwork;

    return (
      <div className="mb-8">
        <div
          onTouchStart={() => handleCardPress(currentNetwork.networkId)}
          onMouseDown={() => handleCardPress(currentNetwork.networkId)}
          onTouchEnd={handleCardRelease}
          onMouseUp={handleCardRelease}
          onMouseLeave={handleCardRelease}
          className="bg-white/10 rounded-xl p-6 select-none border border-white/10"
        >
          <div className="flex justify-between items-center">
            <div className="min-w-0 flex-1">
              <h4 className="text-[28px] font-[580] text-white tracking-tight truncate pr-4">
                {currentNetwork.ssid}
              </h4>
              {!networkStatus && (
                <p className="text-white/60 text-[20px]">Connecting...</p>
              )}
            </div>
            <div className="flex items-center space-x-3">
              <div className="text-green-500 flex items-center space-x-1">
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
              (n) => n.ssid === network.ssid,
            );
            const inRange = !!scanNetwork;

            return (
              <div
                key={network.networkId}
                onClick={() =>
                  inRange && handleConnectToSavedNetwork(network.networkId)
                }
                onTouchStart={() => handleCardPress(network.networkId)}
                onMouseDown={() => handleCardPress(network.networkId)}
                onTouchEnd={handleCardRelease}
                onMouseUp={handleCardRelease}
                onMouseLeave={handleCardRelease}
                className={`bg-white/10 rounded-xl p-6 select-none border border-white/10 
                  ${
                    inRange
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
                  <div className="flex items-center">
                    {hasPasswordSecurity(network.flags) && (
                      <LockIcon className="text-white" size={24} />
                    )}
                    <div
                      className={
                        hasPasswordSecurity(network.flags)
                          ? "ml-3 mr-3"
                          : "mr-3"
                      }
                    >
                      {inRange ? (
                        getSignalIcon(scanNetwork.signal)
                      ) : (
                        <WifiOffIcon className="w-[24px] h-[24px] text-white/60" />
                      )}
                    </div>
                    <button
                      onClick={(e) => handleForgetNetwork(network.networkId, e)}
                      className="hidden"
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
            className="bg-transparent border-none flex items-center space-x-2 text-white/60 hover:text-white transition-colors p-2 rounded-full hover:bg-white/10 focus:outline-none"
            disabled={isScanning || isConnecting}
            aria-label="Refresh networks"
          >
            <RefreshIcon
              className={`w-6 h-6 ${isScanning || isConnecting ? "animate-spin" : ""}`}
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
                <div className="flex items-center space-x-3">
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
          className="bg-white/10 rounded-xl hover:bg-white/20 transition-colors border border-white/10 px-6 py-3 focus:outline-none"
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
          className="bg-white/10 hover:bg-white/20 transition-colors rounded-xl px-6 py-3 text-[28px] font-[560] text-white flex items-center space-x-2 focus:outline-none"
          disabled={isScanning || isConnecting}
        >
          <RefreshIcon
            className={`w-6 h-6 ${isScanning || isConnecting ? "animate-spin" : ""}`}
          />
          <span>Scan for networks</span>
        </button>
      </div>
    );
  }

  const confirmForgetDialog = (
    <Dialog
      open={showForgetDialog}
      onClose={() => {
        setShowForgetDialog(false);
        setSelectedNetworkId(null);
      }}
      className="relative z-50"
    >
      <DialogBackdrop className="fixed inset-0 bg-black/60" />
      <div className="fixed inset-0 z-50 w-screen overflow-y-auto">
        <div
          className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0"
          style={{ fontFamily: "var(--font-inter)" }}
        >
          <DialogPanel className="relative transform overflow-hidden rounded-[17px] bg-[#161616] px-0 pb-0 pt-5 text-left shadow-xl sm:my-8 sm:w-full sm:max-w-[36rem]">
            <div className="text-center">
              <DialogTitle
                as="h3"
                className="text-[36px] font-[560] tracking-tight text-white"
              >
                Forget Network?
              </DialogTitle>
              <div className="mt-2">
                <p className="text-[28px] font-[560] tracking-tight text-white/60">
                  You will need to re-enter the password to connect again.
                </p>
              </div>
            </div>
            <div className="mt-5 sm:grid sm:grid-flow-row-dense sm:grid-cols-2 border-t border-slate-100/25">
              <button
                type="button"
                onClick={() => {
                  setShowForgetDialog(false);
                  setSelectedNetworkId(null);
                }}
                className="inline-flex w-full justify-center px-3 py-3 text-[28px] font-[560] tracking-tight text-[#6c8bd5] border-r border-slate-100/25 bg-transparent hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (selectedNetworkId) {
                    await forgetNetwork(selectedNetworkId);
                  }
                  setShowForgetDialog(false);
                  setSelectedNetworkId(null);
                }}
                className="inline-flex w-full justify-center px-3 py-3 text-[28px] font-[560] tracking-tight text-[#fe3b30] bg-transparent hover:bg-white/5"
              >
                Forget
              </button>
            </div>
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );

  return (
    <div className="space-y-6 transform-gpu will-change-transform">
      {confirmForgetDialog}
      {error && (
        <div className="bg-red-900/40 border border-red-700/60 rounded-xl p-4 mb-4">
          <p className="text-white/80 text-[20px]">{error}</p>
          <button
            onClick={() => scanNetworks(false)}
            className="bg-transparent border-none text-white/60 hover:text-white text-[18px] mt-2 underline transition-colors focus:outline-none"
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
