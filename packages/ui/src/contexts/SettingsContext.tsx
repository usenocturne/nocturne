import React, { createContext, useState, useContext, useEffect } from "react";
import type {
  ChildrenProps,
  SettingsContextValue,
  SettingsState,
} from "../types";
import {
  sendNocturneWsRequest,
  subscribeAppReadyState,
  getAppReadyState,
  addGlobalWsListener,
  getBluetoothConnectionState,
  subscribeBluetoothConnectionState,
  hasConnectedMacosConnector,
  isConnectorPlatform,
} from "../hooks/useNocturned";
import { useSubscription } from "../hooks/useSubscription";

const SETTING_STORAGE_KEYS: Partial<Record<keyof SettingsState, string>> = {
  micMuted: "mockingbird_mic_muted",
};

const getStorageKey = (key: keyof SettingsState | string) =>
  SETTING_STORAGE_KEYS[key] || key;

const getDefaultSettingValue = (
  key: keyof SettingsState,
  defaultValue: boolean,
): boolean => {
  const storageKey = getStorageKey(key);
  const storedValue = localStorage.getItem(storageKey);
  return storedValue !== null ? storedValue === "true" : defaultValue;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

const DIRECT_PHONE_REQUIRED_MESSAGE =
  "Connect a phone directly to change this setting.";
const NOCTURNE_PLUS_REQUIRED_MESSAGE =
  "Subscribe to Nocturne+ to use phone calls and notifications.";

export function SettingsProvider({ children }: ChildrenProps) {
  const [appPlatform, setAppPlatform] = useState(
    () => getAppReadyState().platform,
  );
  const [connectedMacosConnector, setConnectedMacosConnector] = useState(() =>
    hasConnectedMacosConnector(getBluetoothConnectionState().devices),
  );
  const { isSubscribed, hasNocturnePlusAccess } = useSubscription();
  const isMicLocked =
    isConnectorPlatform(appPlatform) || isSubscribed === false;
  const isDirectPhonePresentationLocked =
    (appPlatform !== "ios" && appPlatform !== "android") ||
    connectedMacosConnector;
  const nativePhonePresentationLockReason = isDirectPhonePresentationLocked
    ? "direct_phone"
    : !hasNocturnePlusAccess
      ? "nocturne_plus"
      : null;
  const nativePhonePresentationLockMessage =
    nativePhonePresentationLockReason === "direct_phone"
      ? DIRECT_PHONE_REQUIRED_MESSAGE
      : nativePhonePresentationLockReason === "nocturne_plus"
        ? NOCTURNE_PLUS_REQUIRED_MESSAGE
        : null;
  const isNativePhonePresentationLocked =
    nativePhonePresentationLockReason !== null;

  const [settings, setSettings] = useState<SettingsState>({
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
    idleLockEnabled: getDefaultSettingValue("idleLockEnabled", false),
    idleDisplaySleepEnabled: getDefaultSettingValue(
      "idleDisplaySleepEnabled",
      false,
    ),
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
    nativePhoneCallsEnabled: getDefaultSettingValue(
      "nativePhoneCallsEnabled",
      true,
    ),
    nativeNotificationsEnabled: getDefaultSettingValue(
      "nativeNotificationsEnabled",
      true,
    ),
  });

  const showNativePhoneCalls =
    settings.nativePhoneCallsEnabled !== false &&
    !isNativePhonePresentationLocked;
  const showNativeNotifications =
    settings.nativeNotificationsEnabled !== false &&
    !isNativePhonePresentationLocked;

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
    return subscribeBluetoothConnectionState(({ devices }) => {
      setConnectedMacosConnector(hasConnectedMacosConnector(devices));
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
      console.error("Failed to sync microphone runtime state (mic lock):", err);
    });
  }, [appPlatform, isMicLocked]);

  const updateSetting: SettingsContextValue["updateSetting"] = (key, value) => {
    const newSettings: SettingsState = { ...settings };

    const updateLocalStorage = (updates: Partial<SettingsState>) => {
      Object.entries(updates).forEach(([settingKey, settingValue]) => {
        newSettings[settingKey] = settingValue;
        const storageKey = getStorageKey(settingKey);
        localStorage.setItem(storageKey, String(settingValue));
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
      value={{
        settings,
        updateSetting,
        isMicLocked,
        appPlatform,
        isNativePhonePresentationLocked,
        nativePhonePresentationLockMessage,
        showNativePhoneCalls,
        showNativeNotifications,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within SettingsProvider");
  }
  return context;
}
