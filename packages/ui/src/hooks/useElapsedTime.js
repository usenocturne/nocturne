import { useState, useEffect, useRef } from "react";

export function useElapsedTime() {
  const [elapsedTimeEnabled, setElapsedTimeEnabled] =
  useState(true);

  useEffect(() => {
    const elapsedTimeEnabled = localStorage.getItem("elapsedTimeEnabled");
    if (elapsedTimeEnabled === null) {
      localStorage.setItem("elapsedTimeEnabled", "true");
      setElapsedTimeEnabled(true);
    } else {
      setElapsedTimeEnabled(elapsedTimeEnabled === "true");
    }
  }, []);

  return {
    elapsedTimeEnabled
  };
}