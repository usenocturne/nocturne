import { createContext, useContext, useState, useCallback } from "react";
import type {
  AppNotification,
  ChildrenProps,
  NotificationContextValue,
} from "../types";

const NotificationContext = createContext<NotificationContextValue | null>(
  null,
);

export const NotificationProvider = ({ children }: ChildrenProps) => {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const addNotification = useCallback<
    NotificationContextValue["addNotification"]
  >(
    ({
      icon = null,
      iconSrc = null,
      appName = null,
      title = "",
      description = "",
      action = null,
      onDismiss = null,
    }) => {
      const id = `${Date.now()}-${Math.random()}`;
      setNotifications((prev) => [
        ...prev,
        {
          id,
          icon,
          iconSrc,
          appName,
          title,
          description,
          action,
          onDismiss,
        },
      ]);
      return id;
    },
    [],
  );

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  return (
    <NotificationContext.Provider
      value={{ notifications, addNotification, removeNotification }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = (): NotificationContextValue => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error(
      "useNotifications must be used within NotificationProvider",
    );
  }
  return context;
};
