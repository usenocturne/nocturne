import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import {
  CheckIcon,
  SmartphoneIcon,
  LaptopIcon,
  SpeakerIcon,
  TvIcon,
  TabletIcon,
  GamepadIcon,
  RadiowaveIcon,
  CarIcon,
  CastIcon,
} from "../../icons";
import { inter } from "../../../constants/fonts";

const DeviceSwitcherModal = ({ isOpen, onClose, accessToken, handleError }) => {
  const [devices, setDevices] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isTransferring, setIsTransferring] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchDevices();
    }
  }, [isOpen, accessToken]);

  const fetchDevices = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(
        "https://api.spotify.com/v1/me/player/devices",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch devices");
      }

      const data = await response.json();
      setDevices(data.devices);
    } catch (error) {
      handleError("DEVICES_FETCH_ERROR", error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeviceSelect = async (deviceId) => {
    try {
      setIsTransferring(true);
      const response = await fetch("https://api.spotify.com/v1/me/player", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          device_ids: [deviceId],
          play: true,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to transfer playback");
      }

      onClose();
    } catch (error) {
      handleError("TRANSFER_PLAYBACK_ERROR", error.message);
    } finally {
      setIsTransferring(false);
    }
  };

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-40">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-black/10 transition-opacity data-[closed]:opacity-0 data-[enter]:duration-300 data-[leave]:duration-200 data-[enter]:ease-out data-[leave]:ease-in"
      />

      <div className="fixed inset-0 z-40 w-screen overflow-y-auto">
        <div
          className={`flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0 ${inter.variable}`}
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
                  Switch Device
                </DialogTitle>
                {isLoading ? (
                  <div className="mt-2">
                    <p className="text-[28px] font-[560] tracking-tight text-white/60">
                      Loading available devices...
                    </p>
                  </div>
                ) : devices.length === 0 ? (
                  <div className="mt-2">
                    <p className="text-[28px] font-[560] tracking-tight text-white/60">
                      No devices found
                    </p>
                  </div>
                ) : (
                  <div className="mt-2 space-y-2 px-6 max-h-[60vh] overflow-y-auto">
                    {devices.map((device) => (
                      <button
                        key={device.id}
                        onClick={() => handleDeviceSelect(device.id)}
                        disabled={isTransferring}
                        className="w-full flex items-center justify-between p-4 rounded-xl hover:bg-white/5 transition-colors disabled:opacity-50"
                      >
                        <div className="flex items-center space-x-3">
                          {(() => {
                            switch (device.type) {
                              case "Computer":
                                return (
                                  <LaptopIcon className="h-8 w-8 text-white/60" />
                                );
                              case "Smartphone":
                                return (
                                  <SmartphoneIcon className="h-8 w-8 text-white/60" />
                                );
                              case "Speaker":
                                return (
                                  <SpeakerIcon className="h-8 w-8 text-white/60" />
                                );
                              case "TV":
                                return (
                                  <TvIcon className="h-8 w-8 text-white/60" />
                                );
                              case "Tablet":
                                return (
                                  <TabletIcon className="h-8 w-8 text-white/60" />
                                );
                              case "Gamepad":
                                return (
                                  <GamepadIcon className="h-8 w-8 text-white/60" />
                                );
                              case "AVR":
                              case "STB":
                              case "AudioDongle":
                                return (
                                  <RadiowaveIcon className="h-8 w-8 text-white/60" />
                                );
                              case "Car":
                                return (
                                  <CarIcon className="h-8 w-8 text-white/60" />
                                );
                              case "CastVideo":
                              case "CastAudio":
                                return (
                                  <CastIcon className="h-8 w-8 text-white/60" />
                                );
                              default:
                                return (
                                  <SpeakerIcon className="h-8 w-8 text-white/60" />
                                );
                            }
                          })()}
                          <div className="text-left">
                            <p className="text-[28px] font-[560] tracking-tight text-white">
                              {device.name}
                            </p>
                            <p className="text-[24px] font-[560] tracking-tight text-white/60">
                              {device.type}
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
            <div className="mt-5 sm:grid sm:grid-flow-row-dense sm:grid-cols-1 sm:gap-0 border-t border-slate-100/25">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex w-full justify-center px-3 py-3 text-[28px] font-[560] tracking-tight text-[#6c8bd5] shadow-sm"
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
