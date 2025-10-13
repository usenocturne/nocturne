import React, { useEffect, useRef } from "react";
import { useNotifications } from "../../../contexts/NotificationContext";
import { useUpdateCheck } from "../../../hooks/useUpdateCheck";
import { useSettings } from "../../../contexts/SettingsContext";
import { SettingsUpdateIcon } from "../icons";

function UpdateCheckNotification({
  showLoader,
  setActiveSection,
  currentVersion,
  isInfoLoading,
  refetchInfo,
}) {
  const { addNotification } = useNotifications();
  const hasCheckedRef = useRef(false);
  const hasNotifiedRef = useRef(false);

  const { settings } = useSettings();
  const autoUpdateEnabled = settings?.autoUpdateEnabled;

  const { updateInfo, checkForUpdates } = useUpdateCheck(currentVersion, false);

  useEffect(() => {
    if (showLoader) return;
    if (isInfoLoading) return;
    if (hasCheckedRef.current) return;
    hasCheckedRef.current = true;

    (async () => {
      await refetchInfo();
      checkForUpdates();
    })();
  }, [showLoader, isInfoLoading, checkForUpdates, refetchInfo]);

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
