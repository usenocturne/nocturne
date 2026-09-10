import { describe, expect, test } from "bun:test";
import { createAppLaunchSettingController } from "./useAppLaunchSetting";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("daemon-backed app launch preference", () => {
  test("loads disabled daemon preference and only changes after save acknowledgement", async () => {
    const saved = deferred<unknown>();
    const states: { foreground: boolean; ready: boolean; saving: boolean }[] =
      [];
    const requests: string[] = [];
    const controller = createAppLaunchSettingController(
      async (method, params) => {
        requests.push(method);
        if (method.endsWith(".get")) return { foreground: false };
        expect(params).toEqual({ foreground: true });
        return saved.promise;
      },
      (state) => states.push(state),
    );
    await controller.refresh();
    expect(states.at(-1)).toMatchObject({ foreground: false, ready: true });
    const pending = controller.save(true);
    expect(states.at(-1)).toMatchObject({ foreground: false, saving: true });
    await controller.save(true);
    expect(requests).toEqual(["device.appLaunch.get", "device.appLaunch.set"]);
    saved.resolve({ foreground: true });
    await pending;
    expect(states.at(-1)).toMatchObject({ foreground: true, saving: false });
  });

  test("does not overwrite a newer event with an old initial read", async () => {
    const read = deferred<unknown>();
    const states: { foreground: boolean }[] = [];
    const controller = createAppLaunchSettingController(
      () => read.promise,
      (state) => states.push(state),
    );
    const pending = controller.refresh();
    controller.receive({ foreground: false });
    read.resolve({ foreground: true });
    await pending;
    expect(states.at(-1)?.foreground).toBe(false);
  });

  test("failed save preserves the acknowledged value and exposes the error", async () => {
    const states: {
      foreground: boolean;
      saving: boolean;
      error: string | null;
    }[] = [];
    const controller = createAppLaunchSettingController(
      async (method) => {
        if (method.endsWith(".get")) return { foreground: true };
        throw new Error("disk full");
      },
      (state) => states.push(state),
    );
    await controller.refresh();
    await controller.save(false);
    expect(states.at(-1)).toMatchObject({ foreground: true, saving: false });
    expect(states.at(-1)?.error).toContain("Couldn't save");
  });

  test("disconnect invalidates pending responses and blocks writes until reloaded", async () => {
    const save = deferred<unknown>();
    const states: { foreground: boolean; ready: boolean }[] = [];
    let calls = 0;
    const controller = createAppLaunchSettingController(
      async (method) => {
        calls++;
        return method.endsWith(".get") ? { foreground: true } : save.promise;
      },
      (state) => states.push(state),
    );
    await controller.refresh();
    const pending = controller.save(false);
    controller.disconnect();
    save.resolve({ foreground: false });
    await pending;
    await controller.save(false);
    expect(calls).toBe(2);
    expect(states.at(-1)).toMatchObject({ foreground: true, ready: false });
  });

  test("unknown daemon response never enables writing a presumed default", async () => {
    let calls = 0;
    const states: { ready: boolean }[] = [];
    const controller = createAppLaunchSettingController(
      async () => {
        calls++;
        return {};
      },
      (state) => states.push(state),
    );
    await controller.refresh();
    await controller.save(false);
    expect(calls).toBe(1);
    expect(states.at(-1)?.ready).toBe(false);
  });
});
