import React, { useState, useEffect, useRef } from "react";
import { XIcon } from "../common/icons";

const PlaylistDuplicateConfirmationModal = ({ onConfirm, onCancel }) => {
  const [animationState, setAnimationState] = useState("pre-enter");
  const modalRef = useRef(null);

  useEffect(() => {
    const enterTimeout = setTimeout(() => {
      setAnimationState("entering");

      const animationTimeout = setTimeout(() => {
        setAnimationState("entered");
      }, 50);

      return () => clearTimeout(animationTimeout);
    }, 10);

    return () => clearTimeout(enterTimeout);
  }, []);

  const handleClose = () => {
    setAnimationState("exiting");

    const exitTimeout = setTimeout(() => {
      onCancel();
    }, 350);

    return () => clearTimeout(exitTimeout);
  };

  const handleConfirm = () => {
    setAnimationState("exiting");

    const exitTimeout = setTimeout(() => {
      onConfirm();
    }, 350);

    return () => clearTimeout(exitTimeout);
  };

  const isVisible =
    animationState === "entering" || animationState === "entered";
  const isExiting = animationState === "exiting";

  return (
    <div
      className={`fixed inset-0 z-50 transition-opacity duration-300 ease-out ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
      style={{ pointerEvents: isExiting ? "none" : "auto" }}
    >
      <div className="absolute inset-0 bg-black/60" onClick={handleClose} />
      <div
        ref={modalRef}
        className={`absolute top-1/2 left-1/2 -translate-x-1/2 transition-all duration-300 ease-out ${
          isVisible
            ? "-translate-y-1/2 opacity-100"
            : isExiting
            ? "translate-y-[10%] opacity-0"
            : "translate-y-[10%] opacity-0"
        }`}
      >
        <div className="relative bg-[#161616] p-8 rounded-2xl shadow-2xl min-w-[600px] border border-white/10">
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 text-white/50 hover:text-white transition-colors"
          >
            <XIcon size={24} />
          </button>

          <div className="">
            <h3 className="text-[36px] font-[580] text-white tracking-tight">
              Already Added
            </h3>

            <p className="text-[28px] font-[560] text-white/60 tracking-tight">
              This track is already in this playlist.
            </p>

            <div className="flex justify-end space-x-4 mt-8">
              <button
                onClick={handleClose}
                className="px-6 py-3 text-[28px] font-[560] text-white/70 hover:text-white transition-colors"
              >
                Cancel
              </button>

              <button
                onClick={handleConfirm}
                className="bg-white/10 hover:bg-white/20 transition-colors duration-200 rounded-xl px-6 py-3 border border-white/10"
              >
                <span className="text-[28px] font-[560] text-white tracking-tight">
                  Add Anyway
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlaylistDuplicateConfirmationModal;
