import React, { useEffect, useRef } from "react";
import { useNotifications } from "../../../contexts/NotificationContext";
import { useUpdateCheck } from "../../../hooks/useUpdateCheck";
import { useSettings } from "../../../contexts/SettingsContext";
import { SettingsUpdateIcon } from "../icons";

function UpdateCheckNotification({ setActiveSection, currentVersion }) {
  const { addNotification } = useNotifications();
  const hasNotifiedRef = useRef(false);

  const { settings } = useSettings();
  const autoUpdateEnabled = settings?.autoUpdateEnabled;

  const { updateInfo } = useUpdateCheck(currentVersion, true);

  useEffect(() => {
    if (!updateInfo?.hasUpdate) return;
    if (autoUpdateEnabled) return;
    if (hasNotifiedRef.current) return;
    hasNotifiedRef.current = true;

    addNotification({
      icon: SettingsUpdateIcon,
      title: "Update available",
      description: "A new software update is ready to install.",
      action: {
        label: "Open",
        onPress: () => setActiveSection("settings"),
      },
    });
  }, [updateInfo, addNotification, setActiveSection, autoUpdateEnabled]);

  return null;
}

export default UpdateCheckNotification;
