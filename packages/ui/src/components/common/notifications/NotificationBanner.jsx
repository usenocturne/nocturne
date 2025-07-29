import React from "react";
import { XIcon } from "../icons";

const NotificationBanner = ({ notification, onDismiss }) => {
  const { icon, title, description, action } = notification;

  return (
    <div className="flex items-center gap-3 space-x-3 bg-neutral-900 text-white rounded-xl px-6 py-4 shadow-lg w-full">
      {icon && (
        <div className="text-2xl flex-shrink-0 mr-3">
          {typeof icon === "string" ? icon : React.createElement(icon, { className: "w-6 h-6" })}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[24px] font-[580] truncate">{title}</div>
        {description && <div className="text-[18px] opacity-80 truncate">{description}</div>}
      </div>
      {action && (
        <button
          onClick={() => {
            if (action.onPress) action.onPress();
            onDismiss();
          }}
          className="px-3 py-1 bg-white text-neutral-900 font-medium rounded-md flex-shrink-0 text-[20px]"
        >
          {action.label}
        </button>
      )}
      <button onClick={onDismiss} className="ml-3 leading-none flex-shrink-0 bg-transparent border-none p-0 flex items-center justify-center">
        <XIcon className="w-7 h-7" />
      </button>
    </div>
  );
};

export default NotificationBanner;