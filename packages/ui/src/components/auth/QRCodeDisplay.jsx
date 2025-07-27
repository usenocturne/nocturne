import React, { useEffect, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";

const QRCodeDisplay = ({
  verificationUri,
  isLoading,
  error,
  onRefreshNeeded,
}) => {
  const refreshIntervalRef = useRef(null);
  const lastVerificationUriRef = useRef(verificationUri);

  useEffect(() => {
    if (!verificationUri || verificationUri.trim() === "") {
      if (onRefreshNeeded) {
        onRefreshNeeded();
      }
    }

    refreshIntervalRef.current = setInterval(() => {
      if (!verificationUri || verificationUri.trim() === "") {
        if (onRefreshNeeded) {
          onRefreshNeeded();
        }
      }
    }, 10000);

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    };
  }, [verificationUri, onRefreshNeeded]);

  useEffect(() => {
    lastVerificationUriRef.current = verificationUri;
  }, [verificationUri]);

  if (isLoading) {
    return (
      <div className="animate-pulse bg-white/10 w-[260px] h-[260px] rounded-xl" />
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
    <div className="bg-white p-1 rounded-xl drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)]">
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
