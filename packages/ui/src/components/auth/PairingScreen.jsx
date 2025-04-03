import React from "react";
import { useGradientState } from "../../hooks/useGradientState";
import { NocturneIcon } from "../common/icons";

const PairingScreen = ({ onAccept, onReject, pin, isConnecting }) => {
  const {
    currentColor1,
    currentColor2,
    currentColor3,
    currentColor4,
    generateMeshGradient,
  } = useGradientState();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden">
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
              Bluetooth Pairing
            </h2>
            <p className="text-[28px] text-white tracking-tight">
              Confirm that this pin matches the one on your phone.
            </p>
            <div className="mt-4 flex gap-4 justify-center">
              <button
                onClick={onReject}
                disabled={isConnecting}
                className="flex w-full justify-center text-4xl font-[560] text-white tracking-tight transition-colors duration-200 rounded-[12px] px-6 py-3 border border-white/10 hover:bg-white/10 disabled:opacity-50 bg-black/20"
              >
                Reject
              </button>
              <button
                onClick={onAccept}
                disabled={isConnecting}
                className="flex w-full justify-center bg-black/20 hover:bg-white/10 text-4xl font-[560] text-white tracking-tight transition-colors duration-200 rounded-[12px] px-6 py-3 border border-white/10 disabled:opacity-50"
              >
                {isConnecting ? "Connecting..." : "Accept"}
              </button>
            </div>
          </div>
        </div>

        <div className="flex justify-center">
          <div className="text-[56px] font-bold text-white">{pin}</div>
        </div>
      </div>
    </div>
  );
};

export default PairingScreen; 
