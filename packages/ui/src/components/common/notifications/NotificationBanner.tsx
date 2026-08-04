import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { XIcon } from "../icons";
import type { AppNotification } from "../../../types";
import {
  notificationDescriptionClassName,
  shouldEmphasizeNotificationFirstLine,
} from "./notificationLayout";

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
  const [descriptionScrollHeight, setDescriptionScrollHeight] = useState(0);
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
      setDescriptionScrollHeight(0);
      return;
    }
    setDescriptionScrollHeight(el.scrollHeight);
    if (!expanded) {
      const isTruncated =
        el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight;
      setCanExpand(isTruncated);
    }
  }, [description, descriptionScrollHeight, expanded]);

  useEffect(() => {
    const onResize = () => {
      const el = descriptionRef.current;
      if (!el) return;
      setDescriptionScrollHeight(el.scrollHeight);
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
          className={`flex h-16 w-16 flex-shrink-0 items-center justify-center ${expanded ? "self-start" : "self-center"}`}
        >
          {resolvedIconSrc ? (
            <img
              src={resolvedIconSrc}
              alt=""
              aria-hidden="true"
              draggable={false}
              className="h-16 w-16 rounded-[16px] object-cover shadow-[0_10px_24px_rgba(0,0,0,0.32)] ring-1 ring-[#383842]"
              onError={() => setFailedIconSrc(resolvedIconSrc)}
            />
          ) : typeof icon === "string" ? (
            <div className="flex h-16 w-16 items-center justify-center rounded-[16px] border border-[#3a3a45] bg-[#282832] text-[30px] text-[#d8d8dc]">
              {icon}
            </div>
          ) : icon ? (
            <div className="flex h-16 w-16 items-center justify-center rounded-[16px] border border-[#3a3a45] bg-[#282832] text-[#d8d8dc]">
              {React.createElement(icon, { className: "h-[30px] w-[30px]" })}
            </div>
          ) : null}
        </div>
      )}
      <div className="min-h-0 min-w-0 flex-1">
        {showsAppName && (
          <div className="mb-0.5 truncate text-[14px] font-[580] uppercase leading-[18px] tracking-tight text-[#8b8b94]">
            {appName}
          </div>
        )}
        <div className="truncate text-[25px] font-bold leading-[30px] tracking-tight">
          {title}
        </div>
        {description && (
          <div
            className={notificationDescriptionClassName(
              expanded,
              shouldEmphasizeNotificationFirstLine(
                iconSrc,
                descriptionScrollHeight,
              ),
              showsAppName,
            )}
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
      className={`notification-banner-enter relative flex min-h-[120px] max-h-[160px] w-full gap-[18px] overflow-hidden rounded-[24px] border border-[#33333d] bg-[#121218] px-5 py-[18px] text-white shadow-[0_18px_50px_rgba(0,0,0,0.58)] ${expanded ? "items-start" : "items-center"}`}
    >
      {isInteractive ? (
        <button
          type="button"
          className={`flex min-h-0 min-w-0 flex-1 gap-[18px] border-0 bg-transparent p-0 text-left text-white outline-none focus-visible:ring-2 focus-visible:ring-white ${expanded ? "items-start" : "items-center"}`}
          aria-expanded={expanded}
          onClick={toggleExpanded}
        >
          {notificationContent}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-[18px]">
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
          className="min-h-[52px] flex-shrink-0 rounded-full border border-[#454550] bg-[#2c2c36] px-6 text-[18px] font-[580] tracking-tight text-white transition duration-200 active:scale-[0.97] active:bg-[#3a3a46] focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
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
        className="-mr-1 flex h-[52px] w-[52px] flex-shrink-0 items-center justify-center rounded-full border border-[#393943] bg-[#262630] p-0 text-[#a6a6ae] transition duration-200 active:scale-[0.94] active:bg-[#34343e] active:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <XIcon className="h-6 w-6" />
      </button>
    </div>
  );
};

export default NotificationBanner;
