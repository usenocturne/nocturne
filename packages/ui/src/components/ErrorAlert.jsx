import React, { useEffect, useState } from "react";
import { XIcon } from "../components/icons";

export default function ErrorAlert({ error, onClose }) {
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    let timeoutId;

    if (error) {
      setShouldRender(true);
      requestAnimationFrame(() => {
        setIsVisible(true);
      });

      timeoutId = window.setTimeout(() => {
        setIsVisible(false);
        setTimeout(() => {
          setShouldRender(false);
          onClose();
        }, 300);
      }, 5000);
    }

    return () => {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [error, onClose]);

  if (!shouldRender || !error) return null;

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 bottom-0 sm:justify-center sm:px-6 sm:pb-5 lg:px-8 z-50 shadow-xl transition-all duration-300 ease-in-out ${
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      }`}
    >
      <div className="pointer-events-auto flex items-center justify-between gap-x-6 bg-[#fe3b30]/70 backdrop-blur-xl px-6 py-2.5 sm:rounded-xl sm:py-3 sm:pl-4 sm:pr-3.5">
        <p className="text-[28px] font-[560] text-white tracking-tight">
          {error.message}
        </p>
        <button
          type="button"
          className="-m-1.5 flex-none p-1.5"
          onClick={() => {
            setIsVisible(false);
            setTimeout(() => {
              setShouldRender(false);
              onClose();
            }, 300);
          }}
        >
          <span className="sr-only">Dismiss</span>
          <XIcon className="h-12 w-12 text-white" />
        </button>
      </div>
    </div>
  );
}
