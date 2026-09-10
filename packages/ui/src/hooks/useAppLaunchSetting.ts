import { useEffect, useState } from "react";
import { addGlobalWsListener, sendNocturneWsRequest } from "./useNocturned";

interface AppLaunchSettingState {
  foreground: boolean;
  ready: boolean;
  saving: boolean;
  error: string | null;
}

type Request = (method: string, params?: object) => Promise<unknown>;

function readForeground(value: unknown): boolean {
  if (
    !value ||
    typeof value !== "object" ||
    !("foreground" in value) ||
    typeof value.foreground !== "boolean"
  ) {
    throw new Error("Invalid app launch preference response");
  }
  return value.foreground;
}

export function createAppLaunchSettingController(
  request: Request,
  publish: (state: AppLaunchSettingState) => void,
) {
  let state: AppLaunchSettingState = {
    foreground: true,
    ready: false,
    saving: false,
    error: null,
  };
  let generation = 0;
  let active = true;
  let saveSequence = 0;
  const update = (patch: Partial<AppLaunchSettingState>) => {
    state = { ...state, ...patch };
    if (active) publish(state);
  };
  return {
    activate() {
      active = true;
    },
    async refresh() {
      const current = ++generation;
      try {
        const foreground = readForeground(
          await request("device.appLaunch.get"),
        );
        if (!active || current !== generation) return;
        update({ foreground, ready: true, error: null });
      } catch (error) {
        if (!active || current !== generation) return;
        console.warn("Failed to read app launch preference:", error);
        update({
          ready: false,
          error: "Unable to load phone app launch setting.",
        });
      }
    },
    async save(foreground: boolean) {
      if (!active || !state.ready || state.saving) return;
      const current = ++generation;
      const sequence = ++saveSequence;
      update({ saving: true, error: null });
      try {
        const saved = readForeground(
          await request("device.appLaunch.set", { foreground }),
        );
        if (!active || current !== generation) return;
        update({ foreground: saved, error: null });
      } catch (error) {
        if (!active || current !== generation) return;
        console.warn("Failed to save app launch preference:", error);
        update({ error: "Couldn't save. Check the connection and try again." });
      } finally {
        if (active && sequence === saveSequence) update({ saving: false });
      }
    },
    receive(value: unknown) {
      try {
        const foreground = readForeground(value);
        ++generation;
        update({ foreground, ready: true, error: null });
      } catch (error) {
        console.warn("Invalid app launch preference event:", error);
      }
    },
    disconnect() {
      ++generation;
      ++saveSequence;
      update({ ready: false, saving: false });
    },
    dispose() {
      active = false;
      ++generation;
    },
  };
}

export function useAppLaunchSetting() {
  const [state, setState] = useState<AppLaunchSettingState>({
    foreground: true,
    ready: false,
    saving: false,
    error: null,
  });
  const [controller] = useState(() =>
    createAppLaunchSettingController(sendNocturneWsRequest, setState),
  );
  useEffect(() => {
    controller.activate();
    const remove = addGlobalWsListener("settings-app-launch", {
      onOpen: () => void controller.refresh(),
      onClose: () => controller.disconnect(),
      onMessage: (message) => {
        if (
          message.type === "event" &&
          message.topic === "device.appLaunch.state"
        ) {
          controller.receive(message.data);
        }
      },
    });
    void controller.refresh();
    return () => {
      remove();
      controller.dispose();
    };
  }, [controller]);
  return { ...state, save: controller.save };
}
