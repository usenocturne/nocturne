import { useEffect, useRef } from "react";
import { useNocturned } from "../../../hooks/useNocturned";
import { useNotifications } from "../../../contexts/NotificationContext";
import { AlertCircleIcon } from "../icons";
const AUTO_DISMISS_ON_SPOTIFY_AUTH_IDS = new Set(["spotify.auth.reconnecting"]);

const iconForCategory = (category) => {
  switch (category) {
    case "subscription.expiry":
      return AlertCircleIcon;
    case "spotify.auth.reconnecting":
      return AlertCircleIcon;
    default:
      return AlertCircleIcon;
  }
};

const NotificationBridge = () => {
  const { addMessageListener, removeMessageListener } = useNocturned();
  const { addNotification, removeNotification } = useNotifications();
  const seenIdsRef = useRef(new Set());
  const autoDismissInternalIdsRef = useRef(new Map());

  useEffect(() => {
    const handler = (message) => {
      if (!message || message.type !== "event") return;

      if (message.topic === "notification.show") {
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

        const internalId = addNotification({
          icon: iconForCategory(category),
          title,
          description: body,
        });

        if (id && AUTO_DISMISS_ON_SPOTIFY_AUTH_IDS.has(id)) {
          autoDismissInternalIdsRef.current.set(id, internalId);
        }
        return;
      }

      if (
        message.topic === "spotify.auth.status" ||
        message.topic === "spotify.auth.completed"
      ) {
        const data = message.data || {};
        const isAuthenticated =
          data.authenticated === true ||
          data.authenticated === 1 ||
          data.authenticated === "1";
        if (!isAuthenticated) return;
        if (autoDismissInternalIdsRef.current.size === 0) return;

        for (const [externalId, internalId] of autoDismissInternalIdsRef.current) {
          removeNotification(internalId);
          seenIdsRef.current.delete(externalId);
        }
        autoDismissInternalIdsRef.current.clear();
      }
    };

    const listenerId = addMessageListener("notification-bridge", handler);
    return () => {
      if (listenerId) removeMessageListener(listenerId);
    };
  }, [addMessageListener, removeMessageListener, addNotification, removeNotification]);

  return null;
};

export default NotificationBridge;
