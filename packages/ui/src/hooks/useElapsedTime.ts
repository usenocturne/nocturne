import { useState } from "react";

export function useElapsedTime() {
  const [elapsedTimeEnabled] = useState(() => {
    const stored = localStorage.getItem("elapsedTimeEnabled");

    if (stored === null) {
      localStorage.setItem("elapsedTimeEnabled", "true");
      return true;
    }

    return stored === "true";
  });

  return {
    elapsedTimeEnabled,
  };
}
