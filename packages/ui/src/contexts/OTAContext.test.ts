import { describe, expect, test } from "bun:test";
import {
  canRunAutomaticOtaCheck,
  canDiscoverUpdate,
  INITIAL_OTA_STATE,
  installedVersionForOtaKind,
  installRequestParams,
  isMatchingOtaCompletion,
  isOtaTargetInstalled,
  isReloadOnlyKind,
  otaVersionRequestParams,
  persistOtaState,
  reconcileRestoredInstalledOtaState,
  reduceOtaLifecycleEvent,
  restorePersistedOtaState,
  shouldAutoInstallUpdate,
  shouldClearRestoredImageOtaState,
  shouldDeferDiscoveryForReconciledOtaState,
  shouldTriggerDiscoveryForAppReady,
} from "./OTAContext";

const PERSISTED_STATE_KEY = "nocturne_ota_state_v2";

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("isReloadOnlyKind", () => {
  test("reloads component updates without rebooting the device", () => {
    expect(isReloadOnlyKind("daemon")).toBe(true);
    expect(isReloadOnlyKind("builtinWebapp")).toBe(true);
    expect(isReloadOnlyKind("bandaid")).toBe(true);
  });

  test("reboots only for image and unknown update kinds", () => {
    expect(isReloadOnlyKind("image")).toBe(false);
    expect(isReloadOnlyKind("unknown")).toBe(false);
    expect(isReloadOnlyKind(null)).toBe(false);
  });
});

describe("shouldAutoInstallUpdate", () => {
  const update = {
    version: "4.2.0+20260726060000",
    kind: "bandaid",
    channel: "stable",
    requiresReflash: false,
  };

  test("installs a discovered update when automatic updates are enabled", () => {
    expect(shouldAutoInstallUpdate(true, update)).toBe(true);
  });

  test("waits for the user when automatic updates are disabled", () => {
    expect(shouldAutoInstallUpdate(false, update)).toBe(false);
  });

  test("never attempts to auto-install an update that requires reflashing", () => {
    expect(
      shouldAutoInstallUpdate(true, { ...update, requiresReflash: true }),
    ).toBe(false);
    expect(shouldAutoInstallUpdate(true, null)).toBe(false);
  });

  test("requires pinned version and kind metadata", () => {
    expect(shouldAutoInstallUpdate(true, { ...update, version: null })).toBe(
      false,
    );
    expect(shouldAutoInstallUpdate(true, { ...update, kind: null })).toBe(
      false,
    );
    expect(shouldAutoInstallUpdate(true, { ...update, kind: "unknown" })).toBe(
      false,
    );
  });
});

describe("isMatchingOtaCompletion", () => {
  test("accepts completion only for the active update", () => {
    expect(isMatchingOtaCompletion("update-a", "update-a")).toBe(true);
    expect(isMatchingOtaCompletion("update-a", "update-b")).toBe(false);
    expect(isMatchingOtaCompletion("update-a", null)).toBe(false);
    expect(isMatchingOtaCompletion(null, "update-a")).toBe(false);
  });
});

describe("isOtaTargetInstalled", () => {
  test("reconciles a restored update with the installed device version", () => {
    expect(
      isOtaTargetInstalled("4.2.0+20260726060000", "4.2.0+20260726060000"),
    ).toBe(true);
    expect(isOtaTargetInstalled("v4.2.0", "4.2.0")).toBe(true);
    expect(isOtaTargetInstalled("4.1.0", "4.2.0")).toBe(false);
    expect(isOtaTargetInstalled(null, "4.2.0")).toBe(false);
  });

  test("selects the installed version for the update kind", () => {
    expect(installedVersionForOtaKind("image", "5.0.0", "4.1.0", "5.0.0")).toBe(
      "4.1.0",
    );
    expect(
      installedVersionForOtaKind("bandaid", "5.0.0", "4.1.0", "5.0.0"),
    ).toBe("5.0.0");
    expect(installedVersionForOtaKind("image", "4.1.0", null, null)).toBeNull();
  });
});

describe("shouldClearRestoredImageOtaState", () => {
  const restoredImage = {
    ...INITIAL_OTA_STATE,
    isActive: true,
    updateId: "update-a",
    kind: "image",
    version: "4.2.0+20260726060000",
  };

  test("clears active and completed image state after the target image boots", () => {
    expect(
      shouldClearRestoredImageOtaState(restoredImage, "4.2.0+20260726060000"),
    ).toBe(true);
    expect(
      reconcileRestoredInstalledOtaState(
        restoredImage,
        "5.0.0+20260727060000",
        "4.2.0+20260726060000",
        "5.0.0+20260727060000",
      ),
    ).toBe(INITIAL_OTA_STATE);
    expect(
      reconcileRestoredInstalledOtaState(
        { ...restoredImage, isActive: false, isComplete: true },
        "5.0.0+20260727060000",
        "4.2.0+20260726060000",
        "5.0.0+20260727060000",
      ),
    ).toBe(INITIAL_OTA_STATE);
    expect(
      shouldClearRestoredImageOtaState(
        { ...restoredImage, isActive: false, isComplete: true },
        "4.2.0+20260726060000",
      ),
    ).toBe(true);
  });

  test("requires the explicit image lane before clearing restored state", () => {
    expect(shouldClearRestoredImageOtaState(restoredImage, null)).toBe(false);
    expect(
      reconcileRestoredInstalledOtaState(
        restoredImage,
        "4.2.0+20260726060000",
        null,
        "4.2.0+20260726060000",
      ),
    ).toBe(restoredImage);
  });

  test("keeps a completed image prompt until the target image is installed", () => {
    const completedImage = {
      ...restoredImage,
      isActive: false,
      isComplete: true,
    };
    expect(
      shouldClearRestoredImageOtaState(completedImage, "4.1.0+20260725060000"),
    ).toBe(false);
    expect(
      reconcileRestoredInstalledOtaState(
        completedImage,
        "4.1.0+20260725060000",
        "4.1.0+20260725060000",
        "4.1.0+20260725060000",
      ),
    ).toBe(completedImage);
  });

  test("preserves component completion until its explicit reload action", () => {
    const completedBandaid = {
      ...restoredImage,
      isActive: false,
      isComplete: true,
      kind: "bandaid",
    };
    expect(
      shouldClearRestoredImageOtaState(
        completedBandaid,
        "4.1.0+20260725060000",
      ),
    ).toBe(false);
    expect(
      reconcileRestoredInstalledOtaState(
        completedBandaid,
        "4.2.0+20260726060000",
        "4.1.0+20260725060000",
        "4.2.0+20260726060000",
      ),
    ).toBe(completedBandaid);
  });
});

describe("post-reconciliation discovery", () => {
  test("waits out the stale render, then allows startup discovery", () => {
    expect(
      shouldDeferDiscoveryForReconciledOtaState(true, {
        isActive: false,
        isComplete: true,
      }),
    ).toBe(true);
    expect(
      shouldDeferDiscoveryForReconciledOtaState(true, INITIAL_OTA_STATE),
    ).toBe(false);
    expect(
      shouldDeferDiscoveryForReconciledOtaState(false, {
        isActive: false,
        isComplete: true,
      }),
    ).toBe(false);
  });
});

describe("OTA discovery policy", () => {
  test("waits for initial data before automatic discovery", () => {
    expect(canRunAutomaticOtaCheck(false, true, true, "4.1.2")).toBe(false);
    expect(canRunAutomaticOtaCheck(true, true, true, "4.1.2")).toBe(true);
    expect(canRunAutomaticOtaCheck(true, false, true, "4.1.2")).toBe(false);
    expect(canRunAutomaticOtaCheck(true, true, false, "4.1.2")).toBe(false);
    expect(canRunAutomaticOtaCheck(true, true, true, null)).toBe(false);
    expect(canRunAutomaticOtaCheck(true, true, true, "")).toBe(false);
  });

  test("allows discovery whenever no check, install, or result blocks it", () => {
    expect(canDiscoverUpdate(INITIAL_OTA_STATE)).toBe(true);
    expect(canDiscoverUpdate({ ...INITIAL_OTA_STATE, isChecking: true })).toBe(
      false,
    );
    expect(canDiscoverUpdate({ ...INITIAL_OTA_STATE, isActive: true })).toBe(
      false,
    );
    expect(canDiscoverUpdate({ ...INITIAL_OTA_STATE, isComplete: true })).toBe(
      false,
    );
    expect(
      canDiscoverUpdate({
        ...INITIAL_OTA_STATE,
        available: {
          version: "4.2.0",
          kind: "image",
          channel: "stable",
          requiresReflash: false,
        },
      }),
    ).toBe(false);
  });

  test("triggers only for a newer ready companion generation", () => {
    expect(
      shouldTriggerDiscoveryForAppReady(3, { ready: true, generation: 4 }),
    ).toBe(true);
    expect(
      shouldTriggerDiscoveryForAppReady(3, { ready: true, generation: 3 }),
    ).toBe(false);
    expect(
      shouldTriggerDiscoveryForAppReady(3, { ready: true, generation: 2 }),
    ).toBe(false);
    expect(
      shouldTriggerDiscoveryForAppReady(3, { ready: false, generation: 4 }),
    ).toBe(false);
  });

  test("sends the effective, image, and bandaid versions during discovery", () => {
    expect(otaVersionRequestParams("4.1.0", "4.0.0", "4.1.0")).toEqual({
      currentVersion: "4.1.0",
      imageVersion: "4.0.0",
      bandaidVersion: "4.1.0",
    });
  });

  test("installs against the channel that produced the available release", () => {
    expect(
      installRequestParams(
        {
          version: "4.2.0+20260726060000",
          kind: "bandaid",
          channel: "beta",
          requiresReflash: false,
        },
        "4.1.0",
        "4.0.0",
        "4.1.0",
      ),
    ).toEqual({
      currentVersion: "4.1.0",
      imageVersion: "4.0.0",
      bandaidVersion: "4.1.0",
      channel: "beta",
      targetVersion: "4.2.0+20260726060000",
      targetKind: "bandaid",
    });
  });
});

describe("OTA persistence", () => {
  test("restores active presentation state without restoring pending requests", () => {
    const storage = createStorage({
      [PERSISTED_STATE_KEY]: JSON.stringify({
        isActive: true,
        updateId: "update-a",
        kind: "image",
        version: "4.2.0",
        phase: "streaming",
        percent: 37,
        isInstallPending: true,
      }),
    });

    expect(restorePersistedOtaState(storage)).toMatchObject({
      isActive: true,
      updateId: "update-a",
      kind: "image",
      version: "4.2.0",
      phase: "streaming",
      percent: 37,
      isInstallPending: false,
    });
  });

  test("removes malformed and idle snapshots", () => {
    const malformed = createStorage({ [PERSISTED_STATE_KEY]: "{" });
    expect(restorePersistedOtaState(malformed)).toEqual(INITIAL_OTA_STATE);
    expect(malformed.values.has(PERSISTED_STATE_KEY)).toBe(false);

    const idle = createStorage({
      [PERSISTED_STATE_KEY]: JSON.stringify({
        isActive: false,
        isComplete: false,
        updateId: "update-a",
      }),
    });
    expect(restorePersistedOtaState(idle)).toEqual(INITIAL_OTA_STATE);
    expect(idle.values.has(PERSISTED_STATE_KEY)).toBe(false);
  });

  test("persists only active or completed updates", () => {
    const storage = createStorage({ [PERSISTED_STATE_KEY]: "stale" });
    persistOtaState(INITIAL_OTA_STATE, storage);
    expect(storage.values.has(PERSISTED_STATE_KEY)).toBe(false);

    persistOtaState(
      {
        ...INITIAL_OTA_STATE,
        isComplete: true,
        updateId: "update-a",
        kind: "bandaid",
        version: "4.2.0",
      },
      storage,
    );
    const saved = JSON.parse(storage.values.get(PERSISTED_STATE_KEY) ?? "{}");
    expect(saved).toMatchObject({
      isActive: false,
      isComplete: true,
      updateId: "update-a",
      kind: "bandaid",
      version: "4.2.0",
    });
    expect(typeof saved.savedAt).toBe("number");
  });
});

describe("OTA lifecycle state", () => {
  const availableState = {
    ...INITIAL_OTA_STATE,
    available: {
      version: "4.2.0+20260726060000",
      kind: "image",
      channel: "stable",
      requiresReflash: false,
    },
    isInstallPending: true,
  };

  test("requires valid begin metadata and ignores orphan progress", () => {
    const orphan = reduceOtaLifecycleEvent(INITIAL_OTA_STATE, "ota.progress", {
      percent: 50,
    });
    expect(orphan).toBe(INITIAL_OTA_STATE);

    const invalid = reduceOtaLifecycleEvent(availableState, "ota.begin", {
      kind: "image",
    });
    expect(invalid).toMatchObject({
      isActive: false,
      isInstallPending: false,
      error: { code: "invalidUpdateMetadata" },
    });
  });

  test("keeps live image completion pending for an explicit restart", () => {
    const begun = reduceOtaLifecycleEvent(availableState, "ota.begin", {
      updateId: "update-a",
      kind: "image",
    });
    expect(begun).toMatchObject({
      isActive: true,
      isInstallPending: false,
      updateId: "update-a",
      kind: "image",
      version: "4.2.0+20260726060000",
    });

    const progressed = reduceOtaLifecycleEvent(begun, "ota.progress", {
      phase: "streaming",
      percent: 42,
      asset: "system.img.zck",
    });
    expect(progressed).toMatchObject({
      isActive: true,
      phase: "streaming",
      percent: 42,
      asset: "system.img.zck",
    });

    const wrongCompletion = reduceOtaLifecycleEvent(
      progressed,
      "ota.complete",
      { updateId: "update-b" },
    );
    expect(wrongCompletion).toBe(progressed);

    expect(
      reduceOtaLifecycleEvent(progressed, "ota.complete", {
        updateId: "update-a",
      }),
    ).toMatchObject({
      isActive: false,
      isComplete: true,
      updateId: "update-a",
      kind: "image",
      version: "4.2.0+20260726060000",
      error: null,
    });
  });

  test("terminal errors clear active and pending state", () => {
    const active = reduceOtaLifecycleEvent(availableState, "ota.begin", {
      updateId: "update-a",
      kind: "bandaid",
      version: "4.2.0",
    });
    expect(
      reduceOtaLifecycleEvent(active, "ota.error", {
        code: "writeFailed",
        msg: "Could not write the update",
      }),
    ).toMatchObject({
      isActive: false,
      isComplete: false,
      isInstallPending: false,
      error: {
        code: "writeFailed",
        msg: "Could not write the update",
      },
    });
  });
});
