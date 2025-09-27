import React, { useEffect } from "react";
import { useGradientState } from "../../hooks/useGradientState";
import NocturneIcon from "../common/icons/NocturneIcon";
import GradientBackground from "../common/GradientBackground";
import QRCodeDisplay from "./QRCodeDisplay";

const AuthScreen = ({ isLoading = false, error = null, statusMessage = null }) => {
  const [gradientState, updateGradientColors] = useGradientState();

  useEffect(() => {
    updateGradientColors(null, "auth");
  }, [updateGradientColors]);

  return (
    <div className="h-screen flex items-center justify-center overflow-hidden fixed inset-0 rounded-2xl z-50">
      <GradientBackground gradientState={gradientState} />

      <div className="absolute inset-0 bg-black/40" />

      <div className="relative z-10 w-full max-w-6xl px-6 grid grid-cols-2 gap-16 items-center">
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
            verificationUri={null}
            isLoading={isLoading}
            error={error}
          />
        </div>
      </div>
    </div>
  );
};

export default AuthScreen;
