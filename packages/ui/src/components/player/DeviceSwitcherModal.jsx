import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import {
  CheckIcon,
  SpeakerIcon,
  LaptopIcon,
  SmartphoneIcon,
  TvIcon,
  GamepadIcon,
  CarIcon,
} from "../common/icons";
import { useSpotifyWebSocket } from "../../hooks/useSpotifyWebSocket";

const DeviceSwitcherModal = ({ isOpen, onClose, initialDevices }) => {
  const { wsConnected, getDevices, transferPlayback } = useSpotifyWebSocket();
  const safeInitialDevices = Array.isArray(initialDevices)
    ? initialDevices
    : [];

  const [devices, setDevices] = useState(safeInitialDevices);
  const [isLoading, setIsLoading] = useState(safeInitialDevices.length === 0);
  const [isTransferring, setIsTransferring] = useState(false);

  useEffect(() => {
    if (!isOpen || !wsConnected) return;

    if (Array.isArray(initialDevices) && initialDevices.length > 0) {
      setDevices(initialDevices);
      setIsLoading(false);
    } else {
      fetchDevices();
    }
  }, [isOpen, wsConnected, initialDevices]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  const fetchDevices = async () => {
    if (!wsConnected) return;

    try {
      setIsLoading(true);
      const data = await getDevices();
      setDevices(data.devices || []);
    } catch (error) {
      console.error("Error fetching devices:", error);
      setDevices([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeviceSelect = async (deviceId) => {
    if (!wsConnected) return;

    try {
      setIsTransferring(true);
      await transferPlayback(deviceId, true);
      onClose(deviceId);
    } catch (error) {
      console.error("Error transferring playback:", error);
      onClose(null);
    } finally {
      setIsTransferring(false);
    }
  };

  const handleRefresh = () => {
    fetchDevices();
  };

  const getDeviceIcon = (type) => {
    type = type?.toLowerCase() || "";
    if (type.includes("computer") || type.includes("laptop")) {
      return <LaptopIcon className="h-8 w-8 text-white opacity-60" />;
    } else if (type.includes("smartphone") || type.includes("phone")) {
      return <SmartphoneIcon className="h-8 w-8 text-white opacity-60" />;
    } else if (type.includes("tv") || type.includes("television")) {
      return <TvIcon className="h-8 w-8 text-white opacity-60" />;
    } else if (type.includes("game") || type.includes("console")) {
      return <GamepadIcon className="h-8 w-8 text-white opacity-60" />;
    } else if (type.includes("car") || type.includes("auto")) {
      return <CarIcon className="h-8 w-8 text-white opacity-60" />;
    } else {
      return <SpeakerIcon className="h-8 w-8 text-white opacity-60" />;
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog
      open={isOpen}
      onClose={() => onClose(null)}
      className="relative z-40"
    >
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-black transition-opacity data-[closed]:opacity-0 data-[enter]:opacity-100 data-[enter]:duration-300 data-[leave]:duration-300 data-[enter]:ease-out data-[leave]:ease-in"
        style={{ backgroundColor: "rgba(0, 0, 0, 0.4)" }}
      />

      <div className="fixed inset-0 z-40 w-screen overflow-y-hidden">
        <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
          <DialogPanel
            transition
            className="relative transform overflow-hidden rounded-[17px] bg-[#161616] px-0 pb-0 pt-5 text-left shadow-xl transition-all data-[closed]:translate-y-4 data-[closed]:opacity-0 data-[enter]:duration-300 data-[leave]:duration-200 data-[enter]:ease-out data-[leave]:ease-in sm:my-8 sm:w-full sm:max-w-[36rem] data-[closed]:sm:translate-y-0 data-[closed]:sm:scale-95"
          >
            <div>
              <div className="text-center">
                <div className="px-6">
                  <DialogTitle
                    as="h3"
                    className="text-4xl font-medium text-white"
                    style={{
                      fontSize: "36px",
                      fontWeight: 560,
                      letterSpacing: "-0.025em",
                    }}
                  >
                    Switch Device
                  </DialogTitle>
                </div>
                {isLoading ? (
                  <div className="mt-2">
                    <p
                      className="text-white opacity-60"
                      style={{
                        fontSize: "28px",
                        fontWeight: 560,
                        letterSpacing: "-0.025em",
                      }}
                    >
                      Loading available devices...
                    </p>
                  </div>
                ) : devices.length === 0 ? (
                  <div className="mt-2">
                    <p
                      className="text-white opacity-60"
                      style={{
                        fontSize: "28px",
                        fontWeight: 560,
                        letterSpacing: "-0.025em",
                      }}
                    >
                      No devices found
                    </p>
                  </div>
                ) : (
                  <div
                    className="mt-2 px-6 scrollbar-hide"
                    style={{ maxHeight: "60vh", overflowY: "auto" }}
                  >
                    {devices.map((device) => (
                      <button
                        key={device.id}
                        onClick={() => handleDeviceSelect(device.device_id)}
                        disabled={isTransferring}
                        className="w-full flex items-center justify-between p-4 mb-2 rounded-xl hover:bg-white hover:bg-opacity-5 transition-colors disabled:opacity-50"
                        style={{ backgroundColor: "transparent" }}
                      >
                        <div className="flex items-center">
                          <div style={{ marginRight: "12px" }}>
                            {getDeviceIcon(device.device_type)}
                          </div>
                          <div className="text-left">
                            <p
                              className="text-white"
                              style={{
                                fontSize: "28px",
                                fontWeight: 560,
                                letterSpacing: "-0.025em",
                              }}
                            >
                              {device.name}
                            </p>
                          </div>
                        </div>
                        {device.is_active && (
                          <CheckIcon className="h-8 w-8 text-white" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-5 border-t border-slate-100 border-opacity-25 flex">
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isLoading}
                className="flex-1 flex justify-center items-center px-3 py-3 hover:bg-white hover:bg-opacity-5 transition-colors disabled:opacity-50 border-r border-slate-100 border-opacity-25"
                style={{
                  fontSize: "28px",
                  fontWeight: 560,
                  letterSpacing: "-0.025em",
                  color: "#6c8bd5",
                  backgroundColor: "transparent",
                }}
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={() => onClose(null)}
                className="flex-1 flex justify-center items-center px-3 py-3 hover:bg-white hover:bg-opacity-5 transition-colors focus:outline-none outline-none focus:ring-0 appearance-none"
                style={{
                  fontSize: "28px",
                  fontWeight: 560,
                  letterSpacing: "-0.025em",
                  color: "#6c8bd5",
                  backgroundColor: "transparent",
                }}
              >
                Cancel
              </button>
            </div>
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
};

export default DeviceSwitcherModal;
