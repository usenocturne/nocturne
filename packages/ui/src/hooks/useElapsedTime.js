import { useState, useEffect } from "react";

export function useElapsedTime() {
  const [elapsedTimeEnabled, setElapsedTimeEnabled] = useState(false);
  const [remainingTimeEnabled, setRemainingTimeEnabled] = useState(false);

  useEffect(() => {
    const elapsedTimeEnabled = localStorage.getItem("elapsedTimeEnabled");
    const remainingTimeEnabled = localStorage.getItem("remainingTimeEnabled");

    if (elapsedTimeEnabled === null && remainingTimeEnabled === null) {
      localStorage.setItem("elapsedTimeEnabled", "false");
      localStorage.setItem("remainingTimeEnabled", "false");
      setElapsedTimeEnabled(false);
      setRemainingTimeEnabled(false);
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
