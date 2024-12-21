import React from "react";
import { inter } from "../../../constants/fonts";

const PhoneAuthResult = ({ status, error }) => {
  if (status === "success") {
    return (
      <div
        className={`min-h-screen bg-black flex flex-col items-center justify-center p-4 ${inter.variable}`}
      >
        <div className="flex flex-col items-center space-y-6">
          <div className="w-16 h-16 bg-[#1DB954] rounded-full flex items-center justify-center">
            <svg
              width="30"
              height="30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
            >
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">
            Authentication Successful
          </h1>
          <p className="text-white/70">
            You can close this window and return to Nocturne.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
      <div className="flex flex-col items-center space-y-6">
        <div className="w-16 h-16 bg-[#E34D4D] rounded-full flex items-center justify-center">
          <svg
            width="30"
            height="30"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-white">Authentication Error</h1>
        <p className="text-white/70">
          Something went wrong while authenticating.
        </p>
        {error && <div className="text-sm text-red-400/80">{error}</div>}
      </div>
    </div>
  );
};

export default PhoneAuthResult;
