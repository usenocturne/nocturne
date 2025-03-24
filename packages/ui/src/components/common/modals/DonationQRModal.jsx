import React, { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { XIcon } from "../icons";

const DonationQRModal = ({ onClose }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      onClose();
    }, 300);
  };

  return (
    <div
      className={`fixed inset-0 z-50 transition-opacity duration-300 ${
        isVisible && !isExiting ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="absolute inset-0 bg-black/60" onClick={handleClose} />
      <div
        className={`absolute top-1/2 left-1/2 -translate-x-1/2 transition-all duration-300 ${
          isVisible && !isExiting
            ? "-translate-y-1/2 opacity-100"
            : isExiting
            ? "translate-y-[10%] opacity-0"
            : "translate-y-[10%] opacity-0"
        }`}
      >
        <div className="relative bg-black/90 p-8 rounded-3xl shadow-2xl min-w-[400px] border border-white/10">
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 text-white/50 hover:text-white transition-colors"
          >
            <XIcon size={24} />
          </button>
          <div className="flex flex-col items-center space-y-8">
            <div className="bg-white p-1 rounded-xl">
              <QRCodeSVG
                value="https://usenocturne.com/support"
                size={200}
                level="H"
                includeMargin={true}
              />
            </div>
            <div className="space-y-2 text-center">
              <p className="text-white text-2xl">Support Nocturne</p>
              <p className="text-white/50 text-lg">
                Nocturne is free and open-source. Please consider donating to
                support development. Thank you!
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DonationQRModal;
