import { useEffect, useRef } from "react";
import { useNotifications } from "../../../contexts/NotificationContext";
import { addGlobalWsListener } from "../../../hooks/useNocturned";
import type { WsMessage } from "../../../types";
import {
  createNavNotificationController,
  normalizeNavUpdate,
  type NavNotificationController,
} from "./navNotifications";

const NavNotificationBridge = () => {
  const { addNotification, removeNotification } = useNotifications();
  const controllerRef = useRef<NavNotificationController | null>(null);

  useEffect(() => {
    const controller = createNavNotificationController({
      addNotification,
      removeNotification,
    });
    controllerRef.current = controller;

    const removeListener = addGlobalWsListener("nav-notifications", {
      onClose: () => controller.clear(),
      onMessage: (message: WsMessage) => {
        if (message.type !== "event") return;
        if (message.topic === "nav.update") {
          const guidance = normalizeNavUpdate(message.data);
          if (guidance) controller.update(guidance);
          return;
        }
        if (message.topic === "nav.clear") {
          controller.clear();
        }
      },
    });

    return () => {
      removeListener();
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [addNotification, removeNotification]);

  return null;
};

export default NavNotificationBridge;
