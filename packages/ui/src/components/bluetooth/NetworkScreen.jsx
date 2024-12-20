import React from "react";
import NocturneIcon from "../../components/icons";

const NetworkScreen = ({ onAccept, onReject, pin }) => {
  return (
    <div className="bg-black h-screen flex items-center justify-center overflow-hidden fixed inset-0">
      <div className="w-full flex flex-col items-center px-6 py-12 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-2xl">
          <NocturneIcon className="mx-auto h-14 w-auto" />
          <div className="h-[120px]">
            <h2 className="mt-4 text-center text-[46px] font-[580] text-white tracking-tight">
              No Network
            </h2>
            <p className="text-white/70 mt-2 text-center tracking-tight text-[28px]">
              Connect to "Nocturne" in your phone's Bluetooth settings.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NetworkScreen;
