import React, { useEffect, useState, useRef } from "react";
import { useGradientState } from "../../hooks/useGradientState";
import NocturneIcon from "../common/icons/NocturneIcon";
import { ChevronLeftIcon } from "../common/icons";
import GradientBackground from "../common/GradientBackground";
import QRCodeDisplay from "./QRCodeDisplay";
import BluetoothDevices from "../settings/network/BluetoothDevices";

const AuthScreen = ({
  isLoading = false,
  error = null,
  statusMessage = null,
}) => {
  const [gradientState, updateGradientColors] = useGradientState();

  const [showMain, setShowMain] = useState(true);
  const [showSubpage, setShowSubpage] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [bluetoothMounted, setBluetoothMounted] = useState(false);

  const [mainClasses, setMainClasses] = useState("translate-x-0 opacity-100");
  const [subpageClasses, setSubpageClasses] = useState(
    "translate-x-full opacity-0",
  );

  const ANIMATION_DURATION = 300;
  const holdTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);

  useEffect(() => {
    updateGradientColors(null, "auth");
  }, [updateGradientColors]);

  const openBluetoothSettings = () => {
    if (isAnimating) return;
    setIsAnimating(true);
    setBluetoothMounted(true);

    setMainClasses("-translate-x-full opacity-0");
    setSubpageClasses("translate-x-0 opacity-100");

    setTimeout(() => {
      setShowMain(false);
      setShowSubpage(true);
      setIsAnimating(false);
    }, ANIMATION_DURATION);
  };

  const navigateBack = () => {
    if (isAnimating) return;
    setIsAnimating(true);

    setSubpageClasses("translate-x-full opacity-0");
    setMainClasses("translate-x-0 opacity-100");

    setTimeout(() => {
      setShowSubpage(false);
      setShowMain(true);
      setIsAnimating(false);
      setBluetoothMounted(false);
    }, ANIMATION_DURATION);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!e.key || e.key.toLowerCase() !== "m") return;
      if (longPressTriggeredRef.current) return;

      if (!holdTimerRef.current) {
        holdTimerRef.current = setTimeout(() => {
          longPressTriggeredRef.current = true;
          holdTimerRef.current = null;
        }, 600);
      }
    };

    const handleKeyUp = (e) => {
      if (!e.key || e.key.toLowerCase() !== "m") return;

      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }

      if (longPressTriggeredRef.current) {
        longPressTriggeredRef.current = false;
        return;
      }

      if (showSubpage) {
        navigateBack();
      } else {
        openBluetoothSettings();
      }
    };

    const handleEscape = (e) => {
      if (e.key === "Escape" && showSubpage && !isAnimating) {
        navigateBack();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("keydown", handleEscape);
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    };
  }, [showSubpage, isAnimating]);

  return (
    <div className="h-screen w-full flex items-center justify-center overflow-hidden fixed inset-0 rounded-2xl z-50">
      <GradientBackground gradientState={gradientState} />
      <div className="absolute inset-0 bg-black/40" />

      <div className="relative z-10 w-full h-full overflow-hidden">
        <div
          className={`absolute top-0 left-0 w-full h-full screen-transition ${mainClasses}`}
          style={{
            visibility: showMain || isAnimating ? "visible" : "hidden",
            transition: `transform ${ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1)`,
          }}
        >
          <div className="w-full max-w-6xl px-6 mx-auto h-full flex items-center">
            <div className="grid grid-cols-2 gap-16 items-center w-full">
              <div className="flex flex-col items-start space-y-8 ml-12">
                <NocturneIcon className="h-12 w-auto" />

                <div className="space-y-4">
                  <h2 className="text-4xl text-white tracking-tight font-[580] w-[24rem]">
                    Scan the QR code with your phone's camera.
                  </h2>
                  <p className="text-[28px] text-white/60 tracking-tight w-[22rem]">
                    {statusMessage
                      ? statusMessage
                      : "You'll be redirected to download the Nocturne app."}
                  </p>
                </div>
              </div>

              <div className="flex justify-center">
                <QRCodeDisplay
                  verificationUri="https://usenocturne.com/app"
                  isLoading={isLoading}
                  error={error}
                />
              </div>
            </div>
          </div>
        </div>

        <div
          className={`absolute top-0 left-0 w-full h-full screen-transition ${subpageClasses}`}
          style={{
            visibility: showSubpage || isAnimating ? "visible" : "hidden",
            transition: `transform ${ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1)`,
          }}
        >
          <div className="p-12 h-full overflow-y-auto scrollbar-hide">
            <div className="flex items-center mb-4">
              <button
                onClick={navigateBack}
                className="bg-transparent border-none mr-4 focus:outline-none"
                disabled={isAnimating}
              >
                <ChevronLeftIcon className="w-8 h-8 text-white" />
              </button>
              <h2 className="text-[46px] font-[580] text-white tracking-tight">
                Bluetooth
              </h2>
            </div>

            <div className="space-y-6 mb-12">
              {bluetoothMounted && (
                <BluetoothDevices
                  startDiscoveryOnMount={false}
                  stopDiscoveryOnUnmount={false}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthScreen;
