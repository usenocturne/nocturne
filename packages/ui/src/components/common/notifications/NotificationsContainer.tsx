import { createPortal } from "react-dom";
import { useState } from "react";
import type { AnimationEvent } from "react";
import { useNotifications } from "../../../contexts/NotificationContext";
import type { AppNotification } from "../../../types";
import NotificationBanner from "./NotificationBanner";
import { visibleNotificationForExpandedId } from "./notificationLayout";

const NotificationsContainer = () => {
  const { notifications, removeNotification } = useNotifications();
  const [expandedNotificationId, setExpandedNotificationId] = useState<
    string | null
  >(null);
  const target = visibleNotificationForExpandedId(
    notifications,
    expandedNotificationId,
  );
  const [shown, setShown] = useState<AppNotification | null>(target);

  if (!shown && target) setShown(target);

  const exiting = shown !== null && shown.id !== target?.id;
  const notification = exiting ? shown : target;

  if (typeof document === "undefined" || !notification) return null;

  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
      aria-label="Notifications"
      aria-live="polite"
    >
      <div
        key={notification.id}
        className={`w-full max-w-[760px] ${exiting ? "notification-banner-exit" : "pointer-events-auto"}`}
        onAnimationEnd={(e: AnimationEvent<HTMLDivElement>) => {
          if (exiting && e.target === e.currentTarget) setShown(target);
        }}
      >
        <NotificationBanner
          notification={notification}
          onExpandedChange={(expanded) =>
            setExpandedNotificationId(expanded ? notification.id : null)
          }
          onDismiss={() => {
            setExpandedNotificationId(null);
            notification.onDismiss?.();
            removeNotification(notification.id);
          }}
        />
      </div>
    </div>,
    document.body,
  );
};

export default NotificationsContainer;
