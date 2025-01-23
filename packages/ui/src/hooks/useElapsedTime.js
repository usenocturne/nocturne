import { useState, useEffect } from "react";
import { getDefaultSettingValue } from "@/components/settings/Settings";

export function useElapsedTime() {
  const [elapsedTimeEnabled, setElapsedTimeEnabled] = useState(false);
  const [remainingTimeEnabled, setRemainingTimeEnabled] = useState(false);

  useEffect(() => {
    const elapsedTimeEnabled = localStorage.getItem("elapsedTimeEnabled");
    const remainingTimeEnabled = localStorage.getItem("remainingTimeEnabled");

    if (elapsedTimeEnabled === null && remainingTimeEnabled === null) {
      const elapsedTimeDefaultValue = getDefaultSettingValue("playback", "elapsedTimeEnabled");
      const remainingTimeDefaultValue = getDefaultSettingValue("playback", "remainingTimeEnabled");
      localStorage.setItem("elapsedTimeEnabled", elapsedTimeDefaultValue);
      localStorage.setItem("remainingTimeEnabled", remainingTimeDefaultValue);
      setElapsedTimeEnabled(elapsedTimeDefaultValue);
      setRemainingTimeEnabled(remainingTimeDefaultValue);
    } else {
      setElapsedTimeEnabled(elapsedTimeEnabled === "true");
      setRemainingTimeEnabled(remainingTimeEnabled === "true");

      if (elapsedTimeEnabled === "true" && remainingTimeEnabled === "true") {
        localStorage.setItem("remainingTimeEnabled", "false");
        setRemainingTimeEnabled(false);
      }
    }
  }, []);

  return {
    elapsedTimeEnabled,
    remainingTimeEnabled,
    showTimeDisplay: elapsedTimeEnabled || remainingTimeEnabled,
  };
}
