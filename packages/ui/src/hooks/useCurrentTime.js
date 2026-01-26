import { useState, useEffect } from "react";
import { useSettings } from "../contexts/SettingsContext";
import { sendNocturneWsRequest, subscribeAppReadyState } from "./useNocturned";

let cachedTimezone = null;

export const getCachedTimezone = () => cachedTimezone;

export function useCurrentTime() {
  const [currentTime, setCurrentTime] = useState("");
  const [isFourDigits, setIsFourDigits] = useState(false);
  const [appReady, setAppReady] = useState(false);
  const { settings } = useSettings();

  useEffect(() => {
    const unsubscribe = subscribeAppReadyState((state) => {
      setAppReady(state.ready);
    });

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    if (!appReady) return;

    const fetchTimezone = async () => {
      if (cachedTimezone) return;

      try {
        const data = await sendNocturneWsRequest("device.timezone.get", {});
        if (data && data.identifier) {
          cachedTimezone = data.identifier;
        }
      } catch (error) {
        console.error("Error fetching timezone:", error);
      }
    };

    fetchTimezone();
  }, [appReady]);

  useEffect(() => {
    let retryTimeout = null;

    const updateTime = async () => {
      if (!appReady) return;

      try {
        const data = await sendNocturneWsRequest("device.time.get", {});
        if (data && data.time) {
          const timeString = data.time;
          const [hours24, minutes] = timeString.split(":");

          let displayHours;
          if (settings.use24HourTime) {
            displayHours = hours24;
            setIsFourDigits(true);
          } else {
            const hour24 = parseInt(hours24);
            displayHours = (hour24 % 12 || 12).toString();
            setIsFourDigits(parseInt(displayHours) >= 10);
          }

          setCurrentTime(`${displayHours}:${minutes}`);
        } else {
          retryTimeout = setTimeout(updateTime, 5000);
        }
      } catch (error) {
        console.error("Error fetching time from server:", error);
        retryTimeout = setTimeout(updateTime, 5000);
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 15000);

    const handleTimeFormatChange = () => {
      updateTime();
    };

    window.addEventListener("timeFormatChanged", handleTimeFormatChange);

    return () => {
      clearInterval(interval);
      if (retryTimeout) clearTimeout(retryTimeout);
      window.removeEventListener("timeFormatChanged", handleTimeFormatChange);
    };
  }, [settings.use24HourTime, appReady]);

  return {
    currentTime,
    isFourDigits,
  };
}
