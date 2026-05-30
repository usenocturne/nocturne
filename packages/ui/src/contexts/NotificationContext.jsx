import { createContext, useContext, useState, useCallback } from "react";

const NotificationContext = createContext({
  notifications: [],
  addNotification: () => {},
  removeNotification: () => {},
});

export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);

  const addNotification = useCallback(
    ({ icon = null, title = "", description = "", action = null }) => {
      const id = `${Date.now()}-${Math.random()}`;
      setNotifications((prev) => [
        ...prev,
        { id, icon, title, description, action },
      ]);
      return id;
    },
    [],
  );

  const removeNotification = useCallback((id) => {
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

export const useNotifications = () => useContext(NotificationContext);
