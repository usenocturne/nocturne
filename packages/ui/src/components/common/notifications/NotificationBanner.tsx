import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { XIcon } from "../icons";
import type { AppNotification } from "../../../types";
import { notificationDescriptionClassName } from "./notificationLayout";

interface NotificationBannerProps {
  notification: AppNotification;
  onDismiss: () => void;
  onExpandedChange?: (expanded: boolean) => void;
}

const NotificationBanner = ({
  notification,
  onDismiss,
  onExpandedChange,
}: NotificationBannerProps) => {
  const { icon, iconSrc, appName, title, description, action } = notification;
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const [failedIconSrc, setFailedIconSrc] = useState<string | null>(null);
  const descriptionRef = useRef<HTMLDivElement | null>(null);
  const resolvedIconSrc = iconSrc && iconSrc !== failedIconSrc ? iconSrc : null;
  const isInteractive = canExpand || expanded;
  const showsAppName = Boolean(appName && !iconSrc);

  const toggleExpanded = () => {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    onExpandedChange?.(nextExpanded);
  };

  useLayoutEffect(() => {
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
      if (!el) return;
      if (!expanded) {
        const isTruncated =
          el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight;
        setCanExpand(isTruncated);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [expanded]);

  const notificationContent = (
    <>
      {(iconSrc || icon) && (
        <div
          className={`flex h-[72px] w-[72px] flex-shrink-0 items-center justify-center ${expanded ? "self-start" : "self-center"}`}
        >
          {resolvedIconSrc ? (
            <img
              src={resolvedIconSrc}
              alt=""
              aria-hidden="true"
              draggable={false}
              className="h-[72px] w-[72px] rounded-[17px] object-cover"
              onError={() => setFailedIconSrc(resolvedIconSrc)}
            />
          ) : typeof icon === "string" ? (
            <div className="flex h-[72px] w-[72px] items-center justify-center rounded-[17px] bg-[#3a3a3c] text-[34px] text-white">
              {icon}
            </div>
          ) : icon ? (
            <div className="flex h-[72px] w-[72px] items-center justify-center rounded-[17px] bg-[#3a3a3c] text-white">
              {React.createElement(icon, { className: "h-9 w-9" })}
            </div>
          ) : null}
        </div>
      )}
      <div className="min-h-0 min-w-0 flex-1">
        {showsAppName && (
          <div className="truncate text-[18px] font-semibold uppercase leading-[22px] tracking-wide text-white/50">
            {appName}
          </div>
        )}
        <div className="truncate text-[30px] font-semibold leading-[36px] tracking-tight">
          {title}
        </div>
        {description && (
          <div
            className={notificationDescriptionClassName(expanded, showsAppName)}
            ref={descriptionRef}
          >
            {description}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div
      className={`notification-banner-enter relative flex max-h-[200px] w-full gap-4 overflow-hidden rounded-[30px] bg-[#1c1c1e] px-5 py-4 text-white shadow-[0_16px_48px_rgba(0,0,0,0.55)] ring-1 ring-inset ring-white/[0.08] ${expanded ? "items-start" : "items-center"}`}
    >
      {isInteractive ? (
        <button
          type="button"
          className={`flex min-h-0 min-w-0 flex-1 gap-5 border-0 bg-transparent p-0 text-left text-white outline-none focus-visible:ring-2 focus-visible:ring-white ${expanded ? "items-start" : "items-center"}`}
          aria-expanded={expanded}
          onClick={toggleExpanded}
        >
          {notificationContent}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-5">
          {notificationContent}
        </div>
      )}
      {action && (
        <button
          type="button"
          onClick={(e: MouseEvent<HTMLButtonElement>) => {
            e.stopPropagation();
            action.onPress();
            onDismiss();
          }}
          className="h-14 flex-shrink-0 self-center rounded-full bg-white/[0.14] px-6 text-[22px] font-semibold tracking-tight text-white transition duration-200 active:scale-[0.97] active:bg-white/[0.22] focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          {action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={(e: MouseEvent<HTMLButtonElement>) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="flex h-14 w-14 flex-shrink-0 items-center justify-center self-center rounded-full bg-white/[0.1] p-0 text-white/70 transition duration-200 active:scale-[0.94] active:bg-white/[0.2] active:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <XIcon className="h-7 w-7" />
      </button>
    </div>
  );
};

export default NotificationBanner;
