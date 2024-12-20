import React from "react";
import NocturneIcon from "../../components/icons";

const PairingScreen = ({ onAccept, onReject, pin }) => {
  return (
    <div className="bg-black h-screen flex items-center justify-center overflow-hidden fixed inset-0">
      <div className="w-full flex flex-col items-center px-6 py-12 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-2xl">
          <NocturneIcon className="mx-auto h-14 w-auto" />
          <div className="h-[70px]">
            <h2 className="mt-4 text-center text-[46px] font-[580] text-white tracking-tight">
              Bluetooth Pairing
            </h2>
            <p className="text-white/70 mt-2 text-center tracking-tight text-[28px]">
              Confirm that this pin matches the one on your phone.
            </p>
          </div>
        </div>

        <div className="sm:mx-auto sm:w-full sm:max-w-xl">
          <div className="text-center mt-12 mb-8">
            <div className="text-[56px] font-bold text-white">{pin}</div>
          </div>
          <div className="mt-4 flex gap-4 justify-center">
            <button
              onClick={onReject}
              className="flex w-full justify-center rounded-full ring-white/10 ring-2 ring-inset px-6 py-4 text-[32px] font-[560] text-white tracking-tight shadow-sm hover:bg-white/10 transition-colors"
            >
              Reject
            </button>
            <button
              onClick={onAccept}
              className="flex w-full justify-center rounded-full bg-white/10 px-6 py-4 text-[32px] font-[560] text-white tracking-tight shadow-sm"
            >
              Accept
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PairingScreen;
