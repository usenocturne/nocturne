import React, { useEffect, useRef, useState } from "react";
import { XIcon } from "../icons";

const NotificationBanner = ({ notification, onDismiss }) => {
  const { icon, title, description, action } = notification;
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const descriptionRef = useRef(null);

  useEffect(() => {
    const el = descriptionRef.current;
    if (!el) {
      setCanExpand(false);
      return;
    }
    if (!expanded) {
      const isTruncated =
        el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight;
      setCanExpand(isTruncated);
    }
  }, [description, expanded]);

  useEffect(() => {
    const onResize = () => {
      const el = descriptionRef.current;
      if (!el || expanded) return;
      const isTruncated =
        el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight;
      setCanExpand(isTruncated);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [expanded]);

  return (
    <div
      className={`flex ${expanded ? "items-start" : "items-center"} gap-3 space-x-3 bg-neutral-900 text-white rounded-xl px-6 py-4 shadow-lg w-full ${canExpand || expanded ? "cursor-pointer" : "cursor-default"} outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0`}
      onClick={() => {
        if (canExpand || expanded) setExpanded((e) => !e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          if (canExpand || expanded) {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }
      }}
      role={canExpand || expanded ? "button" : undefined}
      aria-expanded={canExpand || expanded ? expanded : undefined}
      tabIndex={canExpand || expanded ? 0 : -1}
    >
      {icon && (
        <div className="text-2xl flex-shrink-0 mr-3 self-center">
          {typeof icon === "string"
            ? icon
            : React.createElement(icon, { className: "w-6 h-6" })}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[24px] font-[580] truncate">{title}</div>
        {description && (
          <div
            className={
              expanded
                ? "text-[18px] opacity-80 whitespace-pre-wrap break-words"
                : "text-[18px] opacity-80 truncate"
            }
            ref={descriptionRef}
          >
            {description}
          </div>
        )}
      </div>
      {action && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (action.onPress) action.onPress();
            onDismiss();
          }}
          className="px-3 py-1 bg-white text-neutral-900 font-medium rounded-md flex-shrink-0 text-[20px] focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
        >
          {action.label}
        </button>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="ml-3 leading-none flex-shrink-0 bg-transparent border-none p-0 flex items-center justify-center focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
      >
        <XIcon className="w-7 h-7" />
      </button>
    </div>
  );
};

export default NotificationBanner;
