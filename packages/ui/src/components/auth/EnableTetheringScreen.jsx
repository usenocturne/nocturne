import React, { useState, useEffect } from "react";
import { useGradientState } from "../../hooks/useGradientState";
import { NocturneIcon } from "../common/icons";

const EnableTetheringScreen = ({ deviceType, message, onDismiss, onDismissRetry }) => {
  const [isVisible, setIsVisible] = useState(true);
  
  const {
    currentColor1,
    currentColor2,
    currentColor3,
    currentColor4,
    generateMeshGradient,
    updateGradientColors,
  } = useGradientState();

  useEffect(() => {
    setIsVisible(true);
    updateGradientColors(null, "auth");
    return () => {};
  }, [deviceType, updateGradientColors]);

  const handleDismiss = () => {
    setIsVisible(false);
    
    if (onDismissRetry) {
      onDismissRetry();
    }
    
    if (onDismiss) {
      onDismiss();
    }
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-black"></div>
      <div
        style={{
          backgroundImage: generateMeshGradient([
            currentColor1,
            currentColor2,
            currentColor3,
            currentColor4,
          ]),
          transition: "background-image 0.5s linear",
        }}
        className="absolute inset-0"
      />

      <div className="relative z-10 w-full max-w-6xl px-6 grid grid-cols-2 gap-16 items-center">
        <div className="flex flex-col items-start space-y-8 ml-12">
          <NocturneIcon className="h-12 w-auto" />

          <div className="space-y-4">
            <h2 className="text-5xl text-white tracking-tight font-[580] w-[24rem]">
              Enable Tethering
            </h2>
            <p className="text-[28px] text-white/60 tracking-tight w-[32rem]">
              {message || "Please enable tethering on your device to continue."}
            </p>

            <button
              onClick={handleDismiss}
              className="mt-4 bg-white/10 hover:bg-white/20 transition-colors duration-200 rounded-xl px-6 py-3 border border-white/10"
            >
              <span className="text-[28px] font-[560] text-white tracking-tight">
                Dismiss
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EnableTetheringScreen;
