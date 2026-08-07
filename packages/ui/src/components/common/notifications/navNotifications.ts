import type { NotificationContextValue, UnknownRecord } from "../../../types";
import { maneuverGlyph } from "./maneuverGlyphs";

export interface NavGuidance {
  instruction: string;
  distance: string;
  eta: string | null;
}

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" ? (value as UnknownRecord) : null;

const readString = (value: UnknownRecord, key: string): string | null => {
  const candidate = value[key];
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const normalizeNavUpdate = (value: unknown): NavGuidance | null => {
  const record = asRecord(value);
  if (!record) return null;
  const instruction = readString(record, "instruction");
  if (!instruction) return null;
  const distance = readString(record, "distance") ?? "";
  const eta = readString(record, "eta");
  return { instruction, distance, eta };
};

export const NAV_NOTIFICATION_DURATION_MS = 8000;

type DismissTimer = ReturnType<typeof setTimeout>;

interface NavNotificationControllerOptions {
  addNotification: NotificationContextValue["addNotification"];
  removeNotification: NotificationContextValue["removeNotification"];
  schedule?: (callback: () => void, delayMs: number) => DismissTimer;
  cancel?: (timer: DismissTimer) => void;
  durationMs?: number;
}

export interface NavNotificationController {
  update: (guidance: NavGuidance) => void;
  clear: () => void;
  dispose: () => void;
}

const navDescription = (guidance: NavGuidance): string =>
  [guidance.distance, guidance.eta].filter(Boolean).join("  ·  ");

export const createNavNotificationController = ({
  addNotification,
  removeNotification,
  schedule = (callback, delayMs) => setTimeout(callback, delayMs),
  cancel = (timer) => clearTimeout(timer),
  durationMs = NAV_NOTIFICATION_DURATION_MS,
}: NavNotificationControllerOptions): NavNotificationController => {
  let lastManeuverKey: string | null = null;
  let currentId: string | null = null;
  let timer: DismissTimer | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
  };

  const removeCurrent = () => {
    if (currentId) {
      removeNotification(currentId);
      currentId = null;
    }
    clearTimer();
  };

  const update = (guidance: NavGuidance) => {
    const maneuverKey = guidance.instruction;
    if (maneuverKey === lastManeuverKey) return;
    lastManeuverKey = maneuverKey;
    removeCurrent();

    const id = addNotification({
      icon: maneuverGlyph(guidance.instruction),
      title: guidance.instruction,
      description: navDescription(guidance),
      onDismiss: () => {
        if (currentId === id) currentId = null;
        clearTimer();
      },
    });
    currentId = id;
    timer = schedule(() => {
      timer = null;
      if (currentId === id) {
        removeNotification(id);
        currentId = null;
      }
    }, durationMs);
  };

  const clear = () => {
    removeCurrent();
    lastManeuverKey = null;
  };

  const dispose = () => {
    clearTimer();
    currentId = null;
    lastManeuverKey = null;
  };

  return { update, clear, dispose };
};
