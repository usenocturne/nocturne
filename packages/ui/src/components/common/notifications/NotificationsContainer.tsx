import { createPortal } from "react-dom";
import { useState } from "react";
import { useNotifications } from "../../../contexts/NotificationContext";
import NotificationBanner from "./NotificationBanner";
import { visibleNotificationsForExpandedId } from "./notificationLayout";

const NotificationsContainer = () => {
  const { notifications, removeNotification } = useNotifications();
  const [expandedNotificationId, setExpandedNotificationId] = useState<
    string | null
  >(null);
  const visibleNotifications = visibleNotificationsForExpandedId(
    notifications,
    expandedNotificationId,
  );

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2.5 px-4"
      aria-label="Notifications"
      aria-live="polite"
    >
      {visibleNotifications.map((n) => (
        <div key={n.id} className="pointer-events-auto w-full max-w-[760px]">
          <NotificationBanner
            notification={n}
            onExpandedChange={(expanded) =>
              setExpandedNotificationId(expanded ? n.id : null)
            }
            onDismiss={() => {
              setExpandedNotificationId(null);
              n.onDismiss?.();
              removeNotification(n.id);
            }}
          />
        </div>
      ))}
    </div>,
    document.body,
  );
};

export default NotificationsContainer;
