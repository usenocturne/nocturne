import { useState, useEffect } from "react";
import { useSettings } from "../contexts/SettingsContext";
import { networkAwareRequest, waitForStableNetwork } from '../utils/networkAwareRequest';

let cachedTimezone = null;
export const getCachedTimezone = () => cachedTimezone;

export function useCurrentTime() {
  const [currentTime, setCurrentTime] = useState("");
  const [isFourDigits, setIsFourDigits] = useState(false);
  const [timezone, setTimezone] = useState(cachedTimezone);
  const { settings } = useSettings();

  useEffect(() => {
    const fetchTimezone = async () => {
      if (cachedTimezone) {
        setTimezone(cachedTimezone);
        return;
      }

      try {
        await waitForStableNetwork();
        const response = await networkAwareRequest(
          () => fetch("http://localhost:5000/device/date/settimezone", {
            method: "POST"
          }),
          0,
          { requireNetwork: true }
        );
        
        if (!response.ok) {
          console.error("Failed to fetch timezone from API, status:", response.status);
          return;
        }

        const data = await response.json();
        if (data.status === "success" && data.timezone) {
          cachedTimezone = data.timezone;
          setTimezone(data.timezone);
          console.log("Timezone set to:", data.timezone);
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
        const response = await fetch("http://localhost:5000/device/date");
        if (response.ok) {
          const data = await response.json();
          const timeString = data.time;
          const [hours24, minutes] = timeString.split(':');

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

      if (timezone && typeof Intl !== 'undefined') {
        try {
          const options = { timeZone: timezone, hour: 'numeric', minute: 'numeric', hour12: !settings.use24HourTime };
          const formatter = new Intl.DateTimeFormat('en-US', options);
          const timeString = formatter.format(now);

          let parts = timeString.split(':');
          let hours = parts[0];
          let minutes = parts[1];

          if (!settings.use24HourTime) {
            minutes = minutes.split(' ')[0];
          }

          setCurrentTime(`${hours}:${minutes}`);
          setIsFourDigits(hours.length >= 2);
          return;
        } catch (error) {
          console.error("Error formatting time with timezone:", error);
        }
      }

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
  }, [settings.use24HourTime, timezone]);

  return {
    currentTime,
    isFourDigits
  };
}
