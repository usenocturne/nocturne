import { createPortal } from "react-dom";
import { useNotifications } from "../../../contexts/NotificationContext";
import NotificationBanner from "./NotificationBanner";

const NotificationsContainer = () => {
  const { notifications, removeNotification } = useNotifications();

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed bottom-6 inset-x-0 px-6 flex flex-col items-stretch gap-4 z-50">
      {notifications.map((n) => (
        <div key={n.id} className="pointer-events-auto">
          <NotificationBanner
            notification={n}
            onDismiss={() => removeNotification(n.id)}
          />
        </div>
      ))}
    </div>,
    document.body,
  );
};

export default NotificationsContainer;