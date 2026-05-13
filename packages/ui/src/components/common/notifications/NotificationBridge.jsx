import { useEffect, useRef } from "react";
import { useNocturned } from "../../../hooks/useNocturned";
import { useNotifications } from "../../../contexts/NotificationContext";
import { AlertCircleIcon } from "../icons";

const iconForCategory = (category) => {
  switch (category) {
    case "subscription.expiry":
      return AlertCircleIcon;
    default:
      return AlertCircleIcon;
  }
};

const NotificationBridge = () => {
  const { addMessageListener, removeMessageListener } = useNocturned();
  const { addNotification } = useNotifications();
  const seenIdsRef = useRef(new Set());

  useEffect(() => {
    const handler = (message) => {
      if (!message || message.type !== "event") return;
      if (message.topic !== "notification.show") return;

      const data = message.data || {};
      const id = data.id;
      const title = data.title;
      const body = data.body || data.description || "";
      const category = data.category || "";

      if (!title) return;

      if (id) {
        if (seenIdsRef.current.has(id)) return;
        seenIdsRef.current.add(id);
      }

      addNotification({
        icon: iconForCategory(category),
        title,
        description: body,
      });
    };

    const listenerId = addMessageListener("notification-bridge", handler);
    return () => {
      if (listenerId) removeMessageListener(listenerId);
    };
  }, [addMessageListener, removeMessageListener, addNotification]);

  return null;
};

export default NotificationBridge;
