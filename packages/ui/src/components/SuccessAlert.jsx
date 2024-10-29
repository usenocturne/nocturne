import React, { useEffect, useState } from "react";

const CheckIcon = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export default function SuccessAlert({ message, onClose, show }) {
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    let timeoutId;

    if (show) {
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
      }, 3000);
    }

    return () => {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [show, onClose]);

  if (!shouldRender) return null;

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 bottom-0 sm:justify-center sm:px-6 sm:pb-5 lg:px-8 z-50 shadow-xl transition-all duration-300 ease-in-out ${
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      }`}
    >
      <div className="pointer-events-auto flex items-center justify-between gap-x-6 bg-emerald-600/70 backdrop-blur-xl px-6 py-2.5 sm:rounded-xl sm:py-3 sm:pl-4 sm:pr-3.5">
        <p className="text-[28px] font-[560] text-white tracking-tight">
          {message || "Shortcut saved successfully"}
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
          <CheckIcon className="h-12 w-12 text-white" />
        </button>
      </div>
    </div>
  );
}
