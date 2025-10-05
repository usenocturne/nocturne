import { useState, useEffect } from "react";
import { useSettings } from "../contexts/SettingsContext";
import { sendNocturneWsRequest } from "./useNocturned";

let cachedTimezone = null;

export const getCachedTimezone = () => cachedTimezone;

export function useCurrentTime() {
  const [currentTime, setCurrentTime] = useState("");
  const [isFourDigits, setIsFourDigits] = useState(false);
  const { settings } = useSettings();

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    const updateTime = async () => {
      try {
        await new Promise((resolve) => setTimeout(resolve, 100));
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
          return;
        }
      } catch (error) {
        console.error("Error fetching time from server:", error);
      }

      const now = new Date();

      let hours;
      if (settings.use24HourTime) {
        hours = now.getHours().toString().padStart(2, "0");
        setIsFourDigits(true);
      } else {
        hours = now.getHours() % 12 || 12;
        setIsFourDigits(hours >= 10);
      }

      const minutes = now.getMinutes().toString().padStart(2, "0");
      const timeString = `${hours}:${minutes}`;
      setCurrentTime(timeString);
    };

    updateTime();
    const interval = setInterval(updateTime, 15000);

    const handleTimeFormatChange = () => {
      updateTime();
    };

    window.addEventListener("timeFormatChanged", handleTimeFormatChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener("timeFormatChanged", handleTimeFormatChange);
    };
  }, [settings.use24HourTime]);

  return {
    currentTime,
    isFourDigits,
  };
}
