import React, { useEffect } from "react";
import { useGradientState } from "../../hooks/useGradientState";
import NocturneIcon from "../common/icons/NocturneIcon";

const NetworkScreen = () => {
  const {
    currentColor1,
    currentColor2,
    currentColor3,
    currentColor4,
    generateMeshGradient,
    updateGradientColors,
  } = useGradientState();

  useEffect(() => {
    updateGradientColors();
  }, [updateGradientColors]);

  return (
    <div className="h-screen w-full flex items-center justify-center overflow-hidden fixed inset-0 rounded-2xl z-50">
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

      <div className="relative z-10 w-full max-w-6xl px-6 mx-auto">
        <div className="grid grid-cols-2 gap-16 items-center">
          <div className="flex flex-col items-start space-y-8 ml-12">
            <NocturneIcon className="h-12 w-auto" />

            <div className="space-y-4">
              <h2 className="text-5xl text-white tracking-tight font-semibold w-[24rem]">
                Connection Lost
              </h2>
              <p className="text-[28px] text-white/60 tracking-tight w-[32rem]">
                Connect to "Nocturne" in your phone's Bluetooth settings.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NetworkScreen;
