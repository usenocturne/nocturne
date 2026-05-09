import React, { createContext, useState, useContext, useEffect } from "react";
import {
  sendNocturneWsRequest,
  subscribeAppReadyState,
  getAppReadyState,
  addGlobalWsListener,
} from "../hooks/useNocturned";
import { useSubscription } from "../hooks/useSubscription";

const SETTING_STORAGE_KEYS = {
  micMuted: "mockingbird_mic_muted",
};

const getStorageKey = (key) => SETTING_STORAGE_KEYS[key] || key;

const getDefaultSettingValue = (key, defaultValue) => {
  const storageKey = getStorageKey(key);
  const storedValue = localStorage.getItem(storageKey);
  return storedValue !== null ? storedValue === "true" : defaultValue;
};

const SettingsContext = createContext();

export function SettingsProvider({ children }) {
  const [appPlatform, setAppPlatform] = useState(
    () => getAppReadyState().platform,
  );
  const { isSubscribed } = useSubscription();
  const isMicLocked = appPlatform === "web" || isSubscribed === false;

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
    startWithNowPlaying: getDefaultSettingValue("startWithNowPlaying", true),
    autoUpdateEnabled: getDefaultSettingValue("autoUpdateEnabled", true),
    betaUpdatesEnabled: getDefaultSettingValue("betaUpdatesEnabled", false),
    knobSeeksPlaybackEnabled: getDefaultSettingValue(
      "knobSeeksPlaybackEnabled",
      false,
    ),
    mockingbirdUiEnabled: getDefaultSettingValue("mockingbirdUiEnabled", false),
    micMuted: getDefaultSettingValue("micMuted", false),
  });

  useEffect(() => {
    Object.entries(settings).forEach(([key, value]) => {
      const storageKey = getStorageKey(key);
      if (localStorage.getItem(storageKey) === null) {
        localStorage.setItem(storageKey, value.toString());
      }
    });
  }, []);

  useEffect(() => {
    return subscribeAppReadyState(({ platform }) => {
      setAppPlatform(platform);
    });
  }, []);

  useEffect(() => {
    return addGlobalWsListener("settings-wakeword-state", {
      onMessage: (data) => {
        if (data?.type !== "event" || data?.topic !== "voice.wakeword.state") {
          return;
        }
        const muted = !!data.data?.muted;
        setSettings((prev) => {
          if (prev.micMuted === muted) return prev;
          localStorage.setItem(getStorageKey("micMuted"), String(muted));
          return { ...prev, micMuted: muted };
        });
      },
    });
  }, []);

  useEffect(() => {
    if (appPlatform === null) return;
    if (!isMicLocked) return;
    sendNocturneWsRequest("wakeword.pause", {}).catch((err) => {
      console.error(
        "Failed to sync microphone runtime state (mic lock):",
        err,
      );
    });
  }, [appPlatform, isMicLocked]);

  const updateSetting = (key, value) => {
    const newSettings = { ...settings };

    const updateLocalStorage = (updates) => {
      Object.entries(updates).forEach(([settingKey, settingValue]) => {
        newSettings[settingKey] = settingValue;
        const storageKey = getStorageKey(settingKey);
        localStorage.setItem(storageKey, settingValue.toString());
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

    if (key === "micMuted" && !isMicLocked) {
      const method = value ? "wakeword.pause" : "wakeword.resume";
      sendNocturneWsRequest(method, {}).catch((err) => {
        console.error(
          `Failed to sync microphone runtime state (${method}):`,
          err,
        );
      });
    }
  };

  return (
    <SettingsContext.Provider
      value={{ settings, updateSetting, isMicLocked }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
