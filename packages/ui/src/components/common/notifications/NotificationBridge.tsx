import { useEffect, useRef } from "react";
import { useNocturned } from "../../../hooks/useNocturned";
import { useNotifications } from "../../../contexts/NotificationContext";
import { useSettings } from "../../../contexts/SettingsContext";
import { useOTA } from "../../../contexts/OTAContext";
import {
  AlertCircleIcon,
  SettingsUpdateIcon,
  SmartphoneIcon,
  notificationIconSrcForBundleId,
} from "../icons";
import type {
  NotificationContextValue,
  NotificationIcon,
  WsMessage,
} from "../../../types";
import type { AvailableUpdate } from "../../../contexts/OTAContext";

export interface NormalizedNotificationShow {
  id: string | null;
  title: string;
  description: string;
  category: string;
  appName: string | null;
  appBundleId: string | null;
  isMirroredPhoneNotification: boolean;
  silent: boolean;
  preExisting: boolean;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;

const stringValue = (
  data: Record<string, unknown>,
  ...keys: string[]
): string | null => {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

const booleanValue = (
  data: Record<string, unknown>,
  ...keys: string[]
): boolean => {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "boolean") return value;
  }
  return false;
};

export const normalizeNotificationShow = (
  value: unknown,
): NormalizedNotificationShow | null => {
  const data = asRecord(value);
  if (!data) return null;
  const appName = stringValue(data, "app_name", "appName");
  const appBundleId = stringValue(data, "app_bundle_id", "appBundleId");
  const title = stringValue(data, "title") || appName;
  if (!title) return null;
  const subtitle = stringValue(data, "subtitle");
  const body = stringValue(data, "body", "description");
  const description = [subtitle, body]
    .filter((part, index, parts): part is string =>
      Boolean(part && parts.indexOf(part) === index),
    )
    .join("\n");
  const category = stringValue(data, "category") || "";
  const isMirroredPhoneNotification =
    category.startsWith("ios.") || category.startsWith("android.");

  return {
    id: stringValue(data, "id"),
    title,
    description,
    category,
    appName,
    appBundleId,
    isMirroredPhoneNotification,
    silent: booleanValue(data, "silent"),
    preExisting: booleanValue(data, "pre_existing", "preExisting"),
  };
};

export const normalizeNotificationRemove = (value: unknown): string | null => {
  const data = asRecord(value);
  return data ? stringValue(data, "id") : null;
};

const isAuthenticated = (value: unknown): boolean => {
  const data = asRecord(value);
  const authenticated = data?.authenticated;
  return authenticated === true || authenticated === 1 || authenticated === "1";
};

const AUTO_DISMISS_ON_SPOTIFY_AUTH_IDS = new Set(["spotify.auth.reconnecting"]);
const MIRRORED_NOTIFICATION_DURATION_MS = 8000;
const MAX_VISIBLE_MIRRORED_NOTIFICATIONS = 3;

const iconForCategory = (category: string): NotificationIcon => {
  if (category.startsWith("ios.") || category.startsWith("android.")) {
    return SmartphoneIcon;
  }
  switch (category) {
    case "connector.ota.available":
      return SettingsUpdateIcon;
    case "subscription.expiry":
      return AlertCircleIcon;
    case "spotify.auth.reconnecting":
      return AlertCircleIcon;
    default:
      return AlertCircleIcon;
  }
};

type DismissTimer = ReturnType<typeof setTimeout>;

interface NotificationBridgeControllerOptions {
  addNotification: NotificationContextValue["addNotification"];
  removeNotification: NotificationContextValue["removeNotification"];
  createId?: () => string;
  schedule?: (callback: () => void, delayMs: number) => DismissTimer;
  cancel?: (timer: DismissTimer) => void;
  mirroredPresentationEnabled?: boolean;
}

export interface NotificationBridgeController {
  handle: (message: WsMessage) => void;
  setMirroredPresentationEnabled: (enabled: boolean) => void;
  dispose: () => void;
}

export interface OtaUpdateNoticeSnapshot {
  autoUpdateEnabled: boolean;
  available: AvailableUpdate | null;
  isActive: boolean;
  isComplete: boolean;
  isInstallPending: boolean;
  isChecking: boolean;
  lastCheckResult: "available" | "upToDate" | null;
}

interface OtaUpdateNotificationControllerOptions {
  addNotification: NotificationContextValue["addNotification"];
  removeNotification: NotificationContextValue["removeNotification"];
}

export interface OtaUpdateNotificationController {
  sync: (snapshot: OtaUpdateNoticeSnapshot) => void;
  dispose: () => void;
}

export const otaUpdateNotificationKey = (
  autoUpdateEnabled: boolean,
  update: AvailableUpdate | null,
): string | null => {
  if (!update?.version || !update.kind) return null;
  if (autoUpdateEnabled && !update.requiresReflash) return null;
  return [
    update.channel,
    update.kind,
    update.version,
    update.requiresReflash ? "reflash" : "install",
  ].join(":");
};

export const createOtaUpdateNotificationController = ({
  addNotification,
  removeNotification,
}: OtaUpdateNotificationControllerOptions): OtaUpdateNotificationController => {
  let current: { key: string; id: string } | null = null;
  let dismissedKey: string | null = null;

  const removeCurrent = () => {
    if (!current) return;
    removeNotification(current.id);
    current = null;
  };

  const reset = () => {
    removeCurrent();
    dismissedKey = null;
  };

  const sync = (snapshot: OtaUpdateNoticeSnapshot) => {
    if (
      snapshot.isActive ||
      snapshot.isComplete ||
      snapshot.isInstallPending ||
      snapshot.lastCheckResult === "upToDate"
    ) {
      reset();
      return;
    }

    const key = otaUpdateNotificationKey(
      snapshot.autoUpdateEnabled,
      snapshot.available,
    );
    if (!key) {
      if (!snapshot.isChecking) reset();
      return;
    }
    if (current?.key === key || dismissedKey === key) return;

    removeCurrent();
    dismissedKey = null;
    const update = snapshot.available;
    if (!update?.version) return;
    const id = addNotification({
      icon: SettingsUpdateIcon,
      appName: "Nocturne",
      title: "Nocturne update available",
      description: update.requiresReflash
        ? `Version ${update.version} requires a computer reflash. Open Software Update in Settings for instructions.`
        : `Version ${update.version} is ready. Open Software Update in Settings to install it.`,
      onDismiss: () => {
        if (current?.key !== key) return;
        current = null;
        dismissedKey = key;
      },
    });
    current = { key, id };
  };

  const dispose = () => reset();

  return { sync, dispose };
};

export const createNotificationBridgeController = ({
  addNotification,
  removeNotification,
  createId = () => crypto.randomUUID(),
  schedule = (callback, delayMs) => setTimeout(callback, delayMs),
  cancel = (timer) => clearTimeout(timer),
  mirroredPresentationEnabled = true,
}: NotificationBridgeControllerOptions): NotificationBridgeController => {
  const internalIds = new Map<string, string>();
  const dismissTimers = new Map<string, DismissTimer>();
  let mirroredOrder: string[] = [];
  let canPresentMirroredNotifications = mirroredPresentationEnabled;
  const autoDismissInternalIds = new Map<string, string>();

  const forgetExternal = (externalId: string) => {
    internalIds.delete(externalId);
    autoDismissInternalIds.delete(externalId);
    const timer = dismissTimers.get(externalId);
    if (timer !== undefined) cancel(timer);
    dismissTimers.delete(externalId);
    mirroredOrder = mirroredOrder.filter(
      (candidate) => candidate !== externalId,
    );
  };

  const dismissExternal = (externalId: string) => {
    const internalId = internalIds.get(externalId);
    if (internalId) removeNotification(internalId);
    forgetExternal(externalId);
  };

  const handle = (message: WsMessage) => {
    if (!message || message.type !== "event") return;

    if (message.topic === "notification.show") {
      const data = normalizeNotificationShow(message.data);
      if (
        !data ||
        (data.isMirroredPhoneNotification &&
          (data.preExisting || !canPresentMirroredNotifications))
      )
        return;
      const externalId =
        data.id ||
        (data.isMirroredPhoneNotification ? `phone:${createId()}` : null);

      if (externalId && internalIds.has(externalId)) {
        if (!data.isMirroredPhoneNotification) return;
        dismissExternal(externalId);
      }
      if (data.isMirroredPhoneNotification && externalId) {
        while (mirroredOrder.length >= MAX_VISIBLE_MIRRORED_NOTIFICATIONS) {
          const oldest = mirroredOrder[0];
          if (!oldest) break;
          dismissExternal(oldest);
        }
      }

      const internalId = addNotification({
        icon: iconForCategory(data.category),
        iconSrc: data.isMirroredPhoneNotification
          ? notificationIconSrcForBundleId(data.appBundleId)
          : null,
        appName: data.appName,
        title: data.title,
        description: data.description,
        onDismiss: externalId ? () => forgetExternal(externalId) : null,
      });

      if (externalId) {
        internalIds.set(externalId, internalId);
        if (AUTO_DISMISS_ON_SPOTIFY_AUTH_IDS.has(externalId)) {
          autoDismissInternalIds.set(externalId, internalId);
        }
        if (data.isMirroredPhoneNotification) {
          mirroredOrder.push(externalId);
          dismissTimers.set(
            externalId,
            schedule(
              () => dismissExternal(externalId),
              MIRRORED_NOTIFICATION_DURATION_MS,
            ),
          );
        }
      }
      return;
    }

    if (message.topic === "notification.remove") {
      const id = normalizeNotificationRemove(message.data);
      if (id) dismissExternal(id);
      return;
    }

    if (
      message.topic === "spotify.auth.status" ||
      message.topic === "spotify.auth.completed"
    ) {
      if (!isAuthenticated(message.data)) return;
      for (const externalId of [...autoDismissInternalIds.keys()]) {
        dismissExternal(externalId);
      }
    }
  };

  const setMirroredPresentationEnabled = (enabled: boolean) => {
    if (canPresentMirroredNotifications === enabled) return;
    canPresentMirroredNotifications = enabled;
    if (enabled) return;
    for (const externalId of [...mirroredOrder]) {
      dismissExternal(externalId);
    }
  };

  const dispose = () => {
    for (const timer of dismissTimers.values()) cancel(timer);
    dismissTimers.clear();
    internalIds.clear();
    autoDismissInternalIds.clear();
    mirroredOrder = [];
  };

  return { handle, setMirroredPresentationEnabled, dispose };
};

const NotificationBridge = () => {
  const { addMessageListener, removeMessageListener } = useNocturned();
  const { addNotification, removeNotification } = useNotifications();
  const { settings, showNativeNotifications } = useSettings();
  const {
    available,
    isActive,
    isComplete,
    isInstallPending,
    isChecking,
    lastCheckResult,
  } = useOTA();
  const controllerRef = useRef<NotificationBridgeController | null>(null);
  const otaControllerRef = useRef<OtaUpdateNotificationController | null>(null);

  useEffect(() => {
    const controller = createNotificationBridgeController({
      addNotification,
      removeNotification,
      mirroredPresentationEnabled: showNativeNotifications,
    });
    controllerRef.current = controller;
    const listenerId = addMessageListener(
      "notification-bridge",
      controller.handle,
    );
    return () => {
      if (listenerId) removeMessageListener(listenerId);
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [
    addMessageListener,
    removeMessageListener,
    addNotification,
    removeNotification,
  ]);

  useEffect(() => {
    controllerRef.current?.setMirroredPresentationEnabled(
      showNativeNotifications,
    );
  }, [showNativeNotifications]);

  useEffect(() => {
    const controller = createOtaUpdateNotificationController({
      addNotification,
      removeNotification,
    });
    otaControllerRef.current = controller;
    return () => {
      controller.dispose();
      if (otaControllerRef.current === controller)
        otaControllerRef.current = null;
    };
  }, [addNotification, removeNotification]);

  useEffect(() => {
    otaControllerRef.current?.sync({
      autoUpdateEnabled: !!settings.autoUpdateEnabled,
      available,
      isActive,
      isComplete,
      isInstallPending,
      isChecking,
      lastCheckResult,
    });
  }, [
    available,
    isActive,
    isComplete,
    isInstallPending,
    isChecking,
    lastCheckResult,
    settings.autoUpdateEnabled,
  ]);

  return null;
};

export default NotificationBridge;
