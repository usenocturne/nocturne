import React from "react";
import { QRCodeSVG } from "qrcode.react";

const QRCodeDisplay = ({ verificationUri, isLoading, error }) => {
  if (isLoading) {
    return (
      <div className="animate-pulse bg-white/10 w-[280px] h-[280px] rounded-xl" />
    );
  }

  if (error) {
    return (
      <div className="w-[280px] h-[280px] rounded-xl bg-white/10 flex items-center justify-center p-6">
        <p className="text-white/70 text-xl text-center">{error}</p>
      </div>
    );
  }

  return (
    <div className="bg-white p-1 rounded-xl">
      <QRCodeSVG
        value={verificationUri || ""}
        size={250}
        level="H"
        includeMargin={true}
      />
    </div>
  );
};

export default QRCodeDisplay;
