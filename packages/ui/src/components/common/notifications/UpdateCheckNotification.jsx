import React, { useEffect, useRef } from "react";
import { useNotifications } from "../../../contexts/NotificationContext";
import { useNocturneVersion } from "../../../hooks/useNocturned";
import { useUpdateCheck } from "../../../hooks/useUpdateCheck";
import { waitForStableNetwork } from "../../../utils/networkAwareRequest";
import { SettingsUpdateIcon } from "../icons";

function UpdateCheckNotification({ showLoader, setActiveSection }) {
  const { addNotification } = useNotifications();
  const hasCheckedRef = useRef(false);
  const hasNotifiedRef = useRef(false);

  const {
    version: currentVersion,
    isLoading: isVersionLoading,
    refetch: refetchVersion,
  } = useNocturneVersion();

  const { updateInfo, checkForUpdates } = useUpdateCheck(currentVersion, false);

  useEffect(() => {
    if (showLoader) return;
    if (isVersionLoading) return;
    if (hasCheckedRef.current) return;
    hasCheckedRef.current = true;

    (async () => {
      try {
        await waitForStableNetwork(5000);
      } catch {}
      await new Promise((r) => setTimeout(r, 3000));
      await refetchVersion();
      checkForUpdates();
    })();
  }, [showLoader, isVersionLoading, checkForUpdates, refetchVersion]);

  useEffect(() => {
    if (!updateInfo?.hasUpdate) return;
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
  }, [updateInfo, addNotification, setActiveSection]);

  return null;
}

export default UpdateCheckNotification;
