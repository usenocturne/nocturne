import React, { createContext, useState, useContext, useEffect } from "react";

const getDefaultSettingValue = (storageKey, defaultValue) => {
  const storedValue = localStorage.getItem(storageKey);
  return storedValue !== null ? storedValue === "true" : defaultValue;
};

const SettingsContext = createContext();

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState({
    use24HourTime: getDefaultSettingValue("use24HourTime", false),
    trackNameScrollingEnabled: getDefaultSettingValue(
      "trackNameScrollingEnabled",
      true,
    ),
    showLyricsGestureEnabled: getDefaultSettingValue(
      "showLyricsGestureEnabled",
      false,
    ),
    songChangeGestureEnabled: getDefaultSettingValue(
      "songChangeGestureEnabled",
      true,
    ),
    lyricsMenuEnabled: getDefaultSettingValue("lyricsMenuEnabled", true),
    elapsedTimeEnabled: getDefaultSettingValue("elapsedTimeEnabled", false),
    remainingTimeEnabled: getDefaultSettingValue("remainingTimeEnabled", false),
    showStatusBar: getDefaultSettingValue("showStatusBar", true),
    startWithNowPlaying: getDefaultSettingValue("startWithNowPlaying", false),
    analyticsEnabled: getDefaultSettingValue("analyticsEnabled", true),
  });

  useEffect(() => {
    Object.entries(settings).forEach(([key, value]) => {
      if (localStorage.getItem(key) === null) {
        localStorage.setItem(key, value.toString());
      }
    });
  }, []);

  const updateSetting = (key, value) => {
    const newSettings = { ...settings };

    const updateLocalStorage = (updates) => {
      Object.entries(updates).forEach(([settingKey, settingValue]) => {
        newSettings[settingKey] = settingValue;
        localStorage.setItem(settingKey, settingValue.toString());
      });
    };

    if (key === "elapsedTimeEnabled" || key === "remainingTimeEnabled") {
      if (value) {
        const isElapsed = key === "elapsedTimeEnabled";
        updateLocalStorage({
          elapsedTimeEnabled: isElapsed,
          remainingTimeEnabled: !isElapsed,
        });
      } else {
        updateLocalStorage({ [key]: false });
      }
    } else if (key === "showLyricsGestureEnabled") {
      if (value) {
        updateLocalStorage({
          showLyricsGestureEnabled: true,
          lyricsMenuEnabled: true,
        });
      } else {
        updateLocalStorage({ [key]: false });
      }
    } else if (key === "lyricsMenuEnabled") {
      if (!value) {
        updateLocalStorage({
          showLyricsGestureEnabled: false,
          lyricsMenuEnabled: false,
        });
      } else {
        updateLocalStorage({ [key]: true });
      }
    } else {
      updateLocalStorage({ [key]: value });
    }

    setSettings(newSettings);

    if (key === "use24HourTime") {
      window.dispatchEvent(new Event("timeFormatChanged"));
    }
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSetting }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
