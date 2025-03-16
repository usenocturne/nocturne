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
  CarIcon
} from "../common/icons";
import { generateRandomString } from "../../utils/helpers";

const DeviceSwitcherModal = ({ isOpen, onClose, accessToken }) => {
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
        `https://gue1-spclient.spotify.com/connect-state/v1/devices/hobs_${generateRandomString(40)}`, {
        method: 'PUT',
        headers: {
          'accept': 'application/json',
          'accept-language': 'en-US,en;q=0.9',
          'authorization': `Bearer ${accessToken}`,
          'content-type': 'application/json',
          'x-spotify-connection-id': generateRandomString(148)
        },
        body: JSON.stringify({
          'member_type': 'CONNECT_STATE',
          'device': {
            'device_info': {
              'capabilities': {
                'can_be_player': false,
                'hidden': true,
                'needs_full_player_state': true
              }
            }
          }
        })
      });

      if (!response.ok) {
        throw new Error("Failed to fetch devices");
      }

      const data = await response.json();
      setDevices(Object.values(data.devices || {}));
    } catch (error) {
      console.error("Error fetching devices:", error);
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
      console.error("Error transferring playback:", error);
    } finally {
      setIsTransferring(false);
    }
  };

  const getDeviceIcon = (type) => {
    type = type?.toLowerCase() || "";
    if (type.includes("computer") || type.includes("laptop")) {
      return <LaptopIcon className="h-8 w-8 text-white/60" />;
    } else if (type.includes("smartphone") || type.includes("phone")) {
      return <SmartphoneIcon className="h-8 w-8 text-white/60" />;
    } else if (type.includes("tv") || type.includes("television")) {
      return <TvIcon className="h-8 w-8 text-white/60" />;
    } else if (type.includes("game") || type.includes("console")) {
      return <GamepadIcon className="h-8 w-8 text-white/60" />;
    } else if (type.includes("car") || type.includes("auto")) {
      return <CarIcon className="h-8 w-8 text-white/60" />;
    } else {
      return <SpeakerIcon className="h-8 w-8 text-white/60" />;
    }
  };

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-40">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-black/40 transition-opacity data-[closed]:opacity-0 data-[enter]:opacity-100 data-[enter]:duration-300 data-[leave]:duration-300 data-[enter]:ease-out data-[leave]:ease-in"
      />

      <div className="fixed inset-0 z-40 w-screen overflow-y-auto">
        <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
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
                        onClick={() => handleDeviceSelect(device.device_id)}
                        disabled={isTransferring}
                        className="w-full flex items-center justify-between p-4 rounded-xl hover:bg-white/5 transition-colors disabled:opacity-50"
                      >
                        <div className="flex items-center space-x-3">
                          {getDeviceIcon(device.device_type)}
                          <div className="text-left">
                            <p className="text-[28px] font-[560] tracking-tight text-white">
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
