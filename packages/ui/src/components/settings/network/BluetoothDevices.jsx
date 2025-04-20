import React, { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  DialogBackdrop,
} from "@headlessui/react";
import { useBluetooth } from "../../../hooks/useNocturned";

const BluetoothDevices = () => {
  const {
    devices,
    loading,
    error,
    fetchDevices,
    connectDevice,
    disconnectDevice,
    forgetDevice,
    startDiscovery,
    stopDiscovery,
  } = useBluetooth();

  const [showForgetDialog, setShowForgetDialog] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const longPressTimer = useRef(null);
  const buttonPressInProgress = useRef(false);
  const hasInitialized = useRef(false);

  useEffect(() => {
    const initialize = async () => {
      if (!hasInitialized.current) {
        hasInitialized.current = true;
        await startDiscovery();
        await fetchDevices(true);
      }
    };

    initialize();

    return () => {
      stopDiscovery();
    };
  }, [startDiscovery, fetchDevices, stopDiscovery]);

  const handleConnect = async (deviceAddress) => {
    await connectDevice(deviceAddress);
  };

  const handleDisconnect = async (deviceAddress) => {
    await disconnectDevice(deviceAddress);
  };

  const handleForget = async () => {
    if (selectedDevice) {
      const success = await forgetDevice(selectedDevice);
      if (success) {
        setShowForgetDialog(false);
        setSelectedDevice(null);
      }
    }
  };

  const handleCardPress = (device) => {
    longPressTimer.current = setTimeout(() => {
      setSelectedDevice(device.address);
      setShowForgetDialog(true);
    }, 800);
  };

  const handleCardRelease = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
  };

  const handleButtonClick = (e, device) => {
    e.stopPropagation();
    buttonPressInProgress.current = true;

    if (device.connected) {
      handleDisconnect(device.address);
    } else {
      handleConnect(device.address);
    }

    setTimeout(() => {
      buttonPressInProgress.current = false;
    }, 100);
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="space-y-4">
          <div className="h-12 bg-white/10 w-1/2 rounded-lg animate-pulse"></div>
          <div className="h-24 bg-white/10 rounded-xl animate-pulse"></div>
          <div className="h-24 bg-white/10 rounded-xl animate-pulse"></div>
        </div>
      );
    }

    if (devices.length === 0) {
      return (
        <div className="bg-white/10 rounded-xl p-8 text-center border border-white/10">
          <p className="text-[32px] font-[580] text-white tracking-tight">
            No Devices Found
          </p>
          <p className="text-[24px] font-[560] text-white/60 tracking-tight mt-2">
            Connect to "Nocturne" in your phone's Bluetooth settings.
          </p>
        </div>
      );
    }

    return devices.map((device) => (
      <div
        key={device.address}
        onTouchStart={() =>
          !buttonPressInProgress.current && handleCardPress(device)
        }
        onMouseDown={() =>
          !buttonPressInProgress.current && handleCardPress(device)
        }
        onTouchEnd={() => !buttonPressInProgress.current && handleCardRelease()}
        onMouseUp={() => !buttonPressInProgress.current && handleCardRelease()}
        onMouseLeave={() => {
          if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
          }
        }}
        className="bg-white/10 rounded-xl p-6 select-none border border-white/10"
      >
        <div className="flex justify-between items-center">
          <div className="min-w-0 flex-1">
            <h4 className="text-[28px] font-[580] text-white tracking-tight truncate pr-4">
              {device.name || device.alias}
            </h4>
            {device.connected && (
              <p className="text-[24px] font-[560] text-white/60 tracking-tight mt-1">
                Connected
              </p>
            )}
          </div>
          <button
            onClick={(e) => handleButtonClick(e, device)}
            className="bg-white/10 hover:bg-white/20 transition-colors duration-200 rounded-xl px-6 py-3 min-w-[160px] border border-white/10"
          >
            <span className="text-[24px] font-[580] text-white tracking-tight">
              {device.connected ? "Disconnect" : "Connect"}
            </span>
          </button>
        </div>
      </div>
    ));
  };

  return (
    <div className="space-y-4" data-bluetooth-settings>
      <h3 className="text-[32px] font-[580] text-white tracking-tight">
        Devices
      </h3>

      <div className="space-y-4">{renderContent()}</div>

      <Dialog
        open={showForgetDialog}
        onClose={() => {
          setShowForgetDialog(false);
          setSelectedDevice(null);
        }}
        className="relative z-50"
      >
        <DialogBackdrop
          transition
          className="fixed inset-0 bg-black/60 transition-opacity data-[closed]:opacity-0 data-[enter]:duration-300 data-[leave]:duration-200 data-[enter]:ease-out data-[leave]:ease-in"
        />

        <div className="fixed inset-0 z-50 w-screen overflow-y-auto">
          <div
            className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0"
            style={{ fontFamily: "var(--font-inter)" }}
          >
            <DialogPanel
              transition
              className="relative transform overflow-hidden rounded-[17px] bg-[#161616] px-0 pb-0 pt-5 text-left shadow-xl transition-all data-[closed]:translate-y-4 data-[closed]:opacity-0 data-[enter]:duration-300 data-[leave]:duration-200 data-[enter]:ease-out data-[leave]:ease-in sm:my-8 sm:w-full sm:max-w-[36rem] data-[closed]:sm:translate-y-0 data-[closed]:sm:scale-95"
            >
              <div>
                <div className="text-center">
                  <DialogTitle
                    as="h3"
                    className="text-[36px] font-[560] tracking-tight text-white"
                  >
                    Forget Device?
                  </DialogTitle>
                  <div className="mt-2">
                    <p className="text-[28px] font-[560] tracking-tight text-white/60">
                      Pair this device again to use it.
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-5 sm:grid sm:grid-flow-row-dense sm:grid-cols-2 sm:gap-0 border-t border-slate-100/25">
                <button
                  type="button"
                  onClick={() => {
                    setShowForgetDialog(false);
                    setSelectedDevice(null);
                  }}
                  className="inline-flex w-full justify-center px-3 py-3 text-[28px] font-[560] tracking-tight text-[#6c8bd5] shadow-sm sm:col-start-1 border-r border-slate-100/25"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleForget}
                  className="mt-3 inline-flex w-full justify-center px-3 py-3 text-[28px] font-[560] tracking-tight text-[#fe3b30] shadow-sm sm:col-start-2 sm:mt-0"
                >
                  Forget
                </button>
              </div>
            </DialogPanel>
          </div>
        </div>
      </Dialog>
    </div>
  );
};

export default BluetoothDevices;
