import React from "react";

const XIcon = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    className={className}
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

export default function ErrorAlert({ error, onClose }) {
  if (!error) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 sm:justify-center sm:px-6 sm:pb-5 lg:px-8 z-50 shadow-xl">
      <div className="pointer-events-auto flex items-center justify-between gap-x-6 bg-[#fe3b30] px-6 py-2.5 sm:rounded-xl sm:py-3 sm:pl-4 sm:pr-3.5">
        <p className="text-[28px] font-[560] text-white tracking-tight">
          {error.message}
        </p>
        <button
          type="button"
          className="-m-1.5 flex-none p-1.5"
          onClick={onClose}
        >
          <span className="sr-only">Dismiss</span>
          <XIcon className="h-12 w-12 text-white" />
        </button>
      </div>
    </div>
  );
}
