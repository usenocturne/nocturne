import {
  createContext,
  useState,
  useContext,
  useEffect,
  useCallback,
  useRef,
} from "react";
import {
  useNocturned,
  useNocturneInfo,
  getGlobalWebSocket,
  subscribeAppReadyState,
} from "../hooks/useNocturned";
import { useSettings } from "./SettingsContext";
import type { ChildrenProps, WsMessage } from "../types";

// Give up the "Checking…" spinner if the companion never answers (e.g. it's
// disconnected or has no internet) so the button doesn't hang forever.
const CHECK_TIMEOUT_MS = 20000;
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const AUTO_CHECK_RETRY_MS = 5 * 60 * 1000;
const INSTALL_START_TIMEOUT_MS = 60 * 1000;
const INSTALL_RETRY_MS = 5 * 60 * 1000;
const ACTIVE_RECOVERY_TIMEOUT_MS = 60 * 1000;
const PERSISTED_OTA_STATE_KEY = "nocturne_ota_state_v2";
const INTERNAL_UPDATE_ID_RE = /^[0-9a-f]{24,}$/i;
const OTA_KINDS = new Set(["image", "daemon", "builtinWebapp", "bandaid"]);

export interface AvailableUpdate {
  version: string | null;
  kind: string | null;
  channel: string;
  requiresReflash: boolean;
}

export interface OTAState {
  // Install progress (driven by the daemon's `ota.*` events).
  isActive: boolean;
  updateId: string | null;
  kind: string | null;
  version: string | null;
  phase: string | null;
  percent: number;
  etaMs: number | null;
  asset: string | null;
  transferredBytes: number | null;
  totalBytes: number | null;
  error: { code?: string; msg?: string } | null;
  isComplete: boolean;
  // Check (driven by the companion's `ota.check_result`). A check NEVER starts a
  // download; the user (or auto-update) must explicitly request the install.
  isChecking: boolean;
  isInstallPending: boolean;
  available: AvailableUpdate | null;
  lastCheckResult: "available" | "upToDate" | null;
}

interface OTAContextValue extends OTAState {
  clearOtaProgress: () => void;
  requestCheck: (currentVersion?: string, channel?: string) => void;
  requestInstall: (currentVersion?: string) => void;
  dismissError: () => void;
}

const OTAContext = createContext<OTAContextValue | null>(null);

export const INITIAL_OTA_STATE: OTAState = {
  isActive: false,
  updateId: null,
  kind: null,
  version: null,
  phase: null,
  percent: 0,
  etaMs: null,
  asset: null,
  transferredBytes: null,
  totalBytes: null,
  error: null,
  isComplete: false,
  isChecking: false,
  isInstallPending: false,
  available: null,
  lastCheckResult: null,
};

type OtaStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function restorePersistedOtaState(
  storage: OtaStorage = localStorage,
): OTAState {
  try {
    const raw = storage.getItem(PERSISTED_OTA_STATE_KEY);
    if (!raw) return INITIAL_OTA_STATE;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      storage.removeItem(PERSISTED_OTA_STATE_KEY);
      return INITIAL_OTA_STATE;
    }
    const saved = parsed as Partial<OTAState>;
    if (
      typeof saved.updateId !== "string" ||
      (!saved.isActive && !saved.isComplete)
    ) {
      storage.removeItem(PERSISTED_OTA_STATE_KEY);
      return INITIAL_OTA_STATE;
    }
    return {
      ...INITIAL_OTA_STATE,
      isActive: saved.isActive === true,
      updateId: saved.updateId,
      kind: typeof saved.kind === "string" ? saved.kind : null,
      version: typeof saved.version === "string" ? saved.version : null,
      phase: typeof saved.phase === "string" ? saved.phase : null,
      percent: typeof saved.percent === "number" ? saved.percent : 0,
      etaMs: typeof saved.etaMs === "number" ? saved.etaMs : null,
      asset: typeof saved.asset === "string" ? saved.asset : null,
      transferredBytes:
        typeof saved.transferredBytes === "number"
          ? saved.transferredBytes
          : null,
      totalBytes:
        typeof saved.totalBytes === "number" ? saved.totalBytes : null,
      isComplete: saved.isComplete === true,
    };
  } catch (error) {
    console.warn("Failed to restore OTA presentation state:", error);
    storage.removeItem(PERSISTED_OTA_STATE_KEY);
    return INITIAL_OTA_STATE;
  }
}

export function persistOtaState(
  state: OTAState,
  storage: OtaStorage = localStorage,
): void {
  try {
    if ((!state.isActive && !state.isComplete) || !state.updateId) {
      storage.removeItem(PERSISTED_OTA_STATE_KEY);
      return;
    }
    storage.setItem(
      PERSISTED_OTA_STATE_KEY,
      JSON.stringify({
        isActive: state.isActive,
        updateId: state.updateId,
        kind: state.kind,
        version: state.version,
        phase: state.phase,
        percent: state.percent,
        etaMs: state.etaMs,
        asset: state.asset,
        transferredBytes: state.transferredBytes,
        totalBytes: state.totalBytes,
        isComplete: state.isComplete,
        savedAt: Date.now(),
      }),
    );
  } catch (error) {
    console.warn("Failed to persist OTA presentation state:", error);
  }
}

export function isReloadOnlyKind(kind: string | null): boolean {
  return kind === "daemon" || kind === "builtinWebapp" || kind === "bandaid";
}

export function shouldAutoInstallUpdate(
  autoUpdateEnabled: boolean,
  update: AvailableUpdate | null,
): boolean {
  return (
    autoUpdateEnabled &&
    update !== null &&
    !update.requiresReflash &&
    typeof update.version === "string" &&
    typeof update.kind === "string" &&
    OTA_KINDS.has(update.kind)
  );
}

export function isMatchingOtaCompletion(
  expectedUpdateId: string | null,
  completedUpdateId: string | null,
): boolean {
  return (
    expectedUpdateId !== null &&
    completedUpdateId !== null &&
    expectedUpdateId === completedUpdateId
  );
}

export function isOtaTargetInstalled(
  currentVersion: string | null,
  targetVersion: string | null,
): boolean {
  if (!currentVersion || !targetVersion) return false;
  return currentVersion.replace(/^v/, "") === targetVersion.replace(/^v/, "");
}

export function installedVersionForOtaKind(
  kind: string | null,
  currentVersion: string | null,
  imageVersion: string | null,
  bandaidVersion: string | null,
): string | null {
  if (kind === "image") return imageVersion;
  if (kind && OTA_KINDS.has(kind)) return bandaidVersion ?? currentVersion;
  return currentVersion;
}

export function shouldClearRestoredImageOtaState(
  state: Pick<OTAState, "isActive" | "isComplete" | "kind" | "version">,
  imageVersion: string | null,
): boolean {
  return (
    state.kind === "image" &&
    (state.isActive || state.isComplete) &&
    isOtaTargetInstalled(imageVersion, state.version)
  );
}

export function shouldDeferDiscoveryForReconciledOtaState(
  reconciliationPending: boolean,
  state: Pick<OTAState, "isActive" | "isComplete">,
): boolean {
  return reconciliationPending && (state.isActive || state.isComplete);
}

export function reconcileRestoredInstalledOtaState(
  state: OTAState,
  currentVersion: string | null,
  imageVersion: string | null,
  bandaidVersion: string | null,
): OTAState {
  if (shouldClearRestoredImageOtaState(state, imageVersion)) {
    return INITIAL_OTA_STATE;
  }
  if (
    state.isActive &&
    isOtaTargetInstalled(
      installedVersionForOtaKind(
        state.kind,
        currentVersion,
        imageVersion,
        bandaidVersion,
      ),
      state.version,
    )
  ) {
    return {
      ...state,
      isActive: false,
      isInstallPending: false,
      isComplete: true,
      error: null,
    };
  }
  return state;
}

export function canDiscoverUpdate(
  state: Pick<OTAState, "isChecking" | "isActive" | "isComplete" | "available">,
): boolean {
  return (
    !state.isChecking &&
    !state.isActive &&
    !state.isComplete &&
    !state.available
  );
}

export function canRunAutomaticOtaCheck(
  initialDataLoaded: boolean,
  wsConnected: boolean,
  appReady: boolean,
  currentVersion: string | null,
): boolean {
  return (
    initialDataLoaded && wsConnected && appReady && Boolean(currentVersion)
  );
}

export function shouldTriggerDiscoveryForAppReady(
  previousGeneration: number,
  state: { ready: boolean; generation: number },
): boolean {
  return state.ready && state.generation > previousGeneration;
}

export function availableUpdateKey(update: AvailableUpdate): string {
  return [update.channel, update.version ?? "", update.kind ?? ""].join(":");
}

export function otaVersionRequestParams(
  currentVersion?: string,
  imageVersion?: string,
  bandaidVersion?: string,
): {
  currentVersion?: string;
  imageVersion?: string;
  bandaidVersion?: string;
} {
  return {
    ...(currentVersion ? { currentVersion } : {}),
    ...(imageVersion ? { imageVersion } : {}),
    ...(bandaidVersion ? { bandaidVersion } : {}),
  };
}

export function installRequestParams(
  update: AvailableUpdate,
  currentVersion?: string,
  imageVersion?: string,
  bandaidVersion?: string,
): {
  currentVersion?: string;
  imageVersion?: string;
  bandaidVersion?: string;
  channel: string;
  targetVersion: string | null;
  targetKind: string | null;
} {
  return {
    ...otaVersionRequestParams(currentVersion, imageVersion, bandaidVersion),
    channel: update.channel,
    targetVersion: update.version,
    targetKind: update.kind,
  };
}

function sendOtaRequest(
  method: "ota.request_check" | "ota.request_install",
  params: Record<string, unknown>,
): boolean {
  const ws = getGlobalWebSocket();
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(
      JSON.stringify({
        type: "request",
        id: Date.now().toString(),
        method,
        params,
      }),
    );
    return true;
  } catch (error) {
    console.error(`Failed to send ${method}:`, error);
    return false;
  }
}

function displayVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const version = value.trim();
  if (!version || INTERNAL_UPDATE_ID_RE.test(version)) return null;
  return version;
}

export function normalizeCurrentVersion(value: unknown): string | undefined {
  return typeof value === "string" && value
    ? value.replace(/^v/, "")
    : undefined;
}

export function reduceOtaLifecycleEvent(
  state: OTAState,
  topic: string,
  data: Record<string, unknown>,
): OTAState {
  if (topic === "ota.begin") {
    const updateId =
      typeof data.updateId === "string" && data.updateId.trim()
        ? data.updateId
        : null;
    const kind =
      typeof data.kind === "string" && OTA_KINDS.has(data.kind)
        ? data.kind
        : null;
    if (!updateId || !kind) {
      return {
        ...INITIAL_OTA_STATE,
        error: {
          code: "invalidUpdateMetadata",
          msg: "The update service returned incomplete install metadata.",
        },
      };
    }
    return {
      ...INITIAL_OTA_STATE,
      isActive: true,
      updateId,
      kind,
      version: displayVersion(data.version) ?? state.available?.version ?? null,
      phase: "Starting...",
    };
  }

  if (topic === "ota.progress") {
    if (!state.isActive || !state.updateId) return state;
    return {
      ...state,
      phase: typeof data.phase === "string" ? data.phase : state.phase,
      percent: typeof data.percent === "number" ? data.percent : state.percent,
      etaMs: typeof data.etaMs === "number" ? data.etaMs : null,
      asset: typeof data.asset === "string" ? data.asset : null,
      transferredBytes:
        typeof data.transferredBytes === "number"
          ? data.transferredBytes
          : null,
      totalBytes: typeof data.totalBytes === "number" ? data.totalBytes : null,
    };
  }

  if (topic === "ota.error") {
    return {
      ...state,
      isActive: false,
      isChecking: false,
      isInstallPending: false,
      isComplete: false,
      error: {
        code: typeof data.code === "string" ? data.code : undefined,
        msg: typeof data.msg === "string" ? data.msg : undefined,
      },
    };
  }

  if (topic === "ota.complete") {
    const completedUpdateId =
      typeof data.updateId === "string" ? data.updateId : null;
    if (!isMatchingOtaCompletion(state.updateId, completedUpdateId)) {
      return state;
    }
    return {
      ...state,
      isActive: false,
      isInstallPending: false,
      isComplete: true,
      error: null,
    };
  }

  return state;
}

type OTAProviderProps = ChildrenProps & { initialDataLoaded: boolean };

export function OTAProvider({ children, initialDataLoaded }: OTAProviderProps) {
  const { addMessageListener, removeMessageListener, wsConnected } =
    useNocturned();
  const {
    version: currentVersion,
    imageVersion,
    bandaidVersion,
    refetch: refetchInfo,
  } = useNocturneInfo();
  const { settings } = useSettings();

  const channel = settings?.betaUpdatesEnabled ? "beta" : "stable";
  const autoUpdateEnabled = !!settings?.autoUpdateEnabled;

  // `useNocturneInfo` fetches `device.version` once on mount, but OTAProvider
  // mounts before the websocket is up, so that early fetch fails and
  // `currentVersion` would stay null forever, blocking the startup check below.
  // Refetch once the socket connects.
  useEffect(() => {
    if (wsConnected) refetchInfo();
  }, [wsConnected, refetchInfo]);

  const restoredOtaStateRef = useRef(false);
  const installedImageReconciliationPendingRef = useRef(false);
  const [otaState, setOtaState] = useState<OTAState>(() => {
    const restored = restorePersistedOtaState();
    restoredOtaStateRef.current = restored.isActive || restored.isComplete;
    return restored;
  });
  const activeUpdateIdRef = useRef(otaState.updateId);

  useEffect(() => {
    persistOtaState(otaState);
  }, [otaState]);

  const [appReadyState, setAppReadyState] = useState({
    ready: false,
    generation: 0,
  });
  useEffect(
    () =>
      subscribeAppReadyState(({ ready, generation }) =>
        setAppReadyState({ ready, generation }),
      ),
    [],
  );
  const channelRef = useRef(channel);
  const installRequestedRef = useRef<string | null>(null);
  const scheduledCheckPendingRef = useRef(false);
  const checkOriginRef = useRef<"manual" | "scheduled">("scheduled");
  const startupDiscoveryRef = useRef(false);
  const checkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const installTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRecoveryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [checkRetry, setCheckRetry] = useState({
    pending: false,
    generation: 0,
  });
  const [installRetry, setInstallRetry] = useState({
    pending: false,
    generation: 0,
  });

  const clearCheckTimeout = useCallback(() => {
    if (checkTimeoutRef.current !== null) {
      clearTimeout(checkTimeoutRef.current);
      checkTimeoutRef.current = null;
    }
  }, []);
  const clearInstallTimeout = useCallback(() => {
    if (installTimeoutRef.current !== null) {
      clearTimeout(installTimeoutRef.current);
      installTimeoutRef.current = null;
    }
  }, []);
  const clearActiveRecoveryTimeout = useCallback(() => {
    if (activeRecoveryTimeoutRef.current !== null) {
      clearTimeout(activeRecoveryTimeoutRef.current);
      activeRecoveryTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    channelRef.current = channel;
  }, [channel]);

  const markCheckFailure = useCallback(
    (message: string) => {
      clearCheckTimeout();
      scheduledCheckPendingRef.current = false;
      setCheckRetry((prev) => ({
        pending: true,
        generation: prev.generation + 1,
      }));
      setOtaState((prev) => ({
        ...prev,
        isChecking: false,
        error:
          checkOriginRef.current === "manual"
            ? { code: "checkFailed", msg: message }
            : null,
      }));
    },
    [clearCheckTimeout],
  );

  const markInstallFailure = useCallback(
    (message: string) => {
      clearInstallTimeout();
      installRequestedRef.current = null;
      setInstallRetry((prev) => ({
        pending: true,
        generation: prev.generation + 1,
      }));
      setOtaState((prev) => ({
        ...prev,
        isInstallPending: false,
        error: { code: "installRequestFailed", msg: message },
      }));
    },
    [clearInstallTimeout],
  );

  const resetInstallTracking = useCallback(
    (clearFailure: boolean) => {
      clearInstallTimeout();
      installRequestedRef.current = null;
      setInstallRetry((prev) =>
        prev.pending ? { ...prev, pending: false } : prev,
      );
      setOtaState((prev) => {
        const error =
          clearFailure && prev.error?.code === "installRequestFailed"
            ? null
            : prev.error;
        if (!prev.isInstallPending && error === prev.error) return prev;
        return { ...prev, isInstallPending: false, error };
      });
    },
    [clearInstallTimeout],
  );

  const markLiveOtaEvent = useCallback(() => {
    restoredOtaStateRef.current = false;
    installedImageReconciliationPendingRef.current = false;
    clearActiveRecoveryTimeout();
  }, [clearActiveRecoveryTimeout]);

  const handleMessage = useCallback(
    (message: WsMessage) => {
      if (message?.type !== "event") return;

      const { topic } = message;
      const data =
        message.data && typeof message.data === "object"
          ? (message.data as Record<string, unknown>)
          : {};

      if (topic === "ota.check_result") {
        clearCheckTimeout();
        const available = data.available === true;
        const requiresReflash = data.requiresReflash === true;
        const reportedError =
          typeof data.error === "string" && data.error.trim() !== ""
            ? data.error.trim()
            : null;
        const checkedVersion = displayVersion(data.version);
        const checkedKind =
          typeof data.kind === "string" && OTA_KINDS.has(data.kind)
            ? data.kind
            : null;
        const checkError =
          reportedError ??
          (available && (!checkedVersion || !checkedKind)
            ? "The update service returned incomplete release metadata."
            : null);
        scheduledCheckPendingRef.current = false;
        setCheckRetry((prev) =>
          checkError
            ? { pending: true, generation: prev.generation + 1 }
            : { ...prev, pending: false },
        );
        setOtaState((prev) => ({
          ...prev,
          isChecking: false,
          available:
            available && !checkError
              ? {
                  version: checkedVersion,
                  kind: checkedKind,
                  channel:
                    typeof data.channel === "string"
                      ? data.channel
                      : channelRef.current,
                  requiresReflash,
                }
              : null,
          lastCheckResult: checkError
            ? null
            : available
              ? "available"
              : "upToDate",
          error: checkError ? { code: "checkFailed", msg: checkError } : null,
        }));
        return;
      }

      if (
        topic !== "ota.begin" &&
        topic !== "ota.progress" &&
        topic !== "ota.error" &&
        topic !== "ota.complete"
      ) {
        return;
      }

      if (topic === "ota.complete") {
        const completedUpdateId =
          typeof data.updateId === "string" ? data.updateId : null;
        if (
          !isMatchingOtaCompletion(activeUpdateIdRef.current, completedUpdateId)
        ) {
          return;
        }
        activeUpdateIdRef.current = null;
      } else if (topic === "ota.begin") {
        const updateId =
          typeof data.updateId === "string" && data.updateId.trim()
            ? data.updateId
            : null;
        const kind =
          typeof data.kind === "string" && OTA_KINDS.has(data.kind)
            ? data.kind
            : null;
        activeUpdateIdRef.current = updateId && kind ? updateId : null;
      } else if (topic === "ota.error") {
        activeUpdateIdRef.current = null;
      }

      markLiveOtaEvent();
      if (topic === "ota.begin" || topic === "ota.error") {
        clearCheckTimeout();
        scheduledCheckPendingRef.current = false;
        setCheckRetry((prev) => ({ ...prev, pending: false }));
      }
      if (
        topic === "ota.begin" ||
        topic === "ota.error" ||
        topic === "ota.complete"
      ) {
        clearInstallTimeout();
        installRequestedRef.current = null;
        setInstallRetry((prev) => ({ ...prev, pending: false }));
      }
      setOtaState((prev) => reduceOtaLifecycleEvent(prev, topic, data));
    },
    [clearCheckTimeout, clearInstallTimeout, markLiveOtaEvent],
  );

  useEffect(() => {
    const listenerId = addMessageListener(
      "ota-progress-context",
      handleMessage,
    );
    return () => removeMessageListener(listenerId);
  }, [addMessageListener, removeMessageListener, handleMessage]);

  const startCheck = useCallback(
    (
      reqVersion: string | undefined,
      reqChannel: string,
      origin: "manual" | "scheduled",
    ) => {
      const requestImageVersion = normalizeCurrentVersion(imageVersion);
      const requestBandaidVersion = normalizeCurrentVersion(bandaidVersion);
      checkOriginRef.current = origin;
      clearCheckTimeout();
      resetInstallTracking(false);
      setCheckRetry((prev) => ({ ...prev, pending: false }));
      setOtaState((prev) => ({
        ...prev,
        isChecking: true,
        isInstallPending: false,
        available: null,
        lastCheckResult: null,
        error: null,
      }));
      if (
        !sendOtaRequest("ota.request_check", {
          ...otaVersionRequestParams(
            reqVersion,
            requestImageVersion,
            requestBandaidVersion,
          ),
          channel: reqChannel,
        })
      ) {
        markCheckFailure("The update service is not connected.");
        return;
      }
      checkTimeoutRef.current = setTimeout(
        () => markCheckFailure("The update check timed out."),
        CHECK_TIMEOUT_MS,
      );
    },
    [
      bandaidVersion,
      clearCheckTimeout,
      imageVersion,
      markCheckFailure,
      resetInstallTracking,
    ],
  );

  const requestCheck = useCallback(
    (reqVersion?: string, reqChannel: string = "stable") =>
      startCheck(reqVersion, reqChannel, "manual"),
    [startCheck],
  );

  const startInstall = useCallback(
    (reqVersion?: string) => {
      const update = otaState.available;
      if (!update || otaState.isInstallPending) return;

      clearInstallTimeout();
      setInstallRetry((prev) => ({ ...prev, pending: false }));
      const params = installRequestParams(
        update,
        reqVersion,
        normalizeCurrentVersion(imageVersion),
        normalizeCurrentVersion(bandaidVersion),
      );
      const requested = sendOtaRequest("ota.request_install", params);
      if (!requested) {
        markInstallFailure("The companion connection is not available.");
        return;
      }

      const key = availableUpdateKey(update);
      installRequestedRef.current = key;
      setOtaState((prev) => ({
        ...prev,
        isInstallPending: true,
        error: null,
      }));
      installTimeoutRef.current = setTimeout(() => {
        if (installRequestedRef.current !== key) return;
        markInstallFailure("The companion did not start the update in time.");
      }, INSTALL_START_TIMEOUT_MS);
    },
    [
      clearInstallTimeout,
      bandaidVersion,
      imageVersion,
      markInstallFailure,
      otaState.available,
      otaState.isInstallPending,
    ],
  );

  const requestInstall = useCallback(
    (reqVersion?: string) => startInstall(reqVersion),
    [startInstall],
  );

  useEffect(() => {
    if (
      !wsConnected ||
      !appReadyState.ready ||
      otaState.isActive ||
      otaState.isComplete ||
      otaState.isInstallPending ||
      installRetry.pending ||
      !shouldAutoInstallUpdate(autoUpdateEnabled, otaState.available)
    ) {
      return;
    }
    const update = otaState.available;
    if (!update) return;
    const key = availableUpdateKey(update);
    if (installRequestedRef.current === key) return;
    startInstall(normalizeCurrentVersion(currentVersion));
  }, [
    appReadyState.ready,
    autoUpdateEnabled,
    currentVersion,
    installRetry.pending,
    otaState.available,
    otaState.isActive,
    otaState.isComplete,
    otaState.isInstallPending,
    startInstall,
    wsConnected,
  ]);

  const dismissError = useCallback(() => {
    setOtaState((prev) => ({ ...prev, error: null }));
  }, []);

  const clearOtaProgress = useCallback(() => {
    startupDiscoveryRef.current = true;
    restoredOtaStateRef.current = false;
    installedImageReconciliationPendingRef.current = false;
    clearCheckTimeout();
    clearInstallTimeout();
    clearActiveRecoveryTimeout();
    activeUpdateIdRef.current = null;
    installRequestedRef.current = null;
    scheduledCheckPendingRef.current = false;
    setCheckRetry((prev) => ({ ...prev, pending: false }));
    setInstallRetry((prev) => ({ ...prev, pending: false }));
    persistOtaState(INITIAL_OTA_STATE);
    setOtaState(INITIAL_OTA_STATE);
  }, [clearActiveRecoveryTimeout, clearCheckTimeout, clearInstallTimeout]);

  useEffect(() => {
    if (restoredOtaStateRef.current) {
      const reconciledState = reconcileRestoredInstalledOtaState(
        otaState,
        currentVersion,
        imageVersion,
        bandaidVersion,
      );
      if (reconciledState !== otaState) {
        installedImageReconciliationPendingRef.current =
          reconciledState === INITIAL_OTA_STATE;
        restoredOtaStateRef.current = false;
        activeUpdateIdRef.current = null;
        clearActiveRecoveryTimeout();
        setOtaState(reconciledState);
        return;
      }
    }
    if (
      !wsConnected ||
      !appReadyState.ready ||
      !currentVersion ||
      !otaState.isActive ||
      !restoredOtaStateRef.current
    ) {
      clearActiveRecoveryTimeout();
      return;
    }
    clearActiveRecoveryTimeout();
    activeRecoveryTimeoutRef.current = setTimeout(() => {
      activeRecoveryTimeoutRef.current = null;
      if (!restoredOtaStateRef.current) return;
      restoredOtaStateRef.current = false;
      activeUpdateIdRef.current = null;
      setOtaState((prev) =>
        prev.isActive
          ? {
              ...INITIAL_OTA_STATE,
              error: {
                code: "otaStateLost",
                msg: "The update status could not be recovered. Check for updates again.",
              },
            }
          : prev,
      );
    }, ACTIVE_RECOVERY_TIMEOUT_MS);
    return clearActiveRecoveryTimeout;
  }, [
    appReadyState.ready,
    bandaidVersion,
    clearActiveRecoveryTimeout,
    currentVersion,
    imageVersion,
    otaState.isActive,
    otaState.isComplete,
    otaState.kind,
    otaState.version,
    wsConnected,
  ]);

  const canStartDiscovery = canDiscoverUpdate(otaState);
  const automaticCheckReady = canRunAutomaticOtaCheck(
    initialDataLoaded,
    wsConnected,
    appReadyState.ready,
    currentVersion,
  );
  const runScheduledCheck = useCallback(() => {
    const installedVersion = normalizeCurrentVersion(currentVersion);
    if (!installedVersion || scheduledCheckPendingRef.current) return;
    scheduledCheckPendingRef.current = true;
    startCheck(installedVersion, channel, "scheduled");
  }, [channel, currentVersion, startCheck]);

  const previousWsConnectedRef = useRef(wsConnected);
  const previousAppReadyGenerationRef = useRef(0);
  useEffect(() => {
    const reconnected = wsConnected && !previousWsConnectedRef.current;
    previousWsConnectedRef.current = wsConnected;
    const companionChanged = shouldTriggerDiscoveryForAppReady(
      previousAppReadyGenerationRef.current,
      appReadyState,
    );
    previousAppReadyGenerationRef.current = Math.max(
      previousAppReadyGenerationRef.current,
      appReadyState.generation,
    );

    if (!wsConnected && otaState.isChecking) {
      markCheckFailure("The connection closed during the update check.");
      return;
    }
    if (!wsConnected && otaState.isInstallPending) {
      clearInstallTimeout();
      installRequestedRef.current = null;
      setInstallRetry((prev) => ({
        pending: true,
        generation: prev.generation + 1,
      }));
      setOtaState((prev) => ({ ...prev, isInstallPending: false }));
      return;
    }
    if (companionChanged && otaState.isChecking) {
      clearCheckTimeout();
      scheduledCheckPendingRef.current = false;
      runScheduledCheck();
      return;
    }
    if (
      (companionChanged || reconnected) &&
      (otaState.isInstallPending || installRetry.pending)
    ) {
      resetInstallTracking(true);
    }
    if (!automaticCheckReady) return;

    if (
      shouldDeferDiscoveryForReconciledOtaState(
        installedImageReconciliationPendingRef.current,
        otaState,
      )
    ) {
      return;
    }
    installedImageReconciliationPendingRef.current = false;

    if (!startupDiscoveryRef.current) {
      if (otaState.isComplete) {
        startupDiscoveryRef.current = true;
        return;
      }
      if (!canStartDiscovery || otaState.error?.code === "otaStateLost") {
        return;
      }
      startupDiscoveryRef.current = true;
      runScheduledCheck();
      return;
    }

    if ((reconnected || companionChanged) && canStartDiscovery) {
      runScheduledCheck();
    }
  }, [
    appReadyState,
    automaticCheckReady,
    canStartDiscovery,
    clearCheckTimeout,
    clearInstallTimeout,
    currentVersion,
    installRetry.pending,
    markCheckFailure,
    otaState.error?.code,
    otaState.isChecking,
    otaState.isComplete,
    otaState.isInstallPending,
    resetInstallTracking,
    runScheduledCheck,
    wsConnected,
  ]);

  useEffect(() => {
    if (!automaticCheckReady || !canStartDiscovery) {
      return;
    }
    const timer = window.setInterval(runScheduledCheck, AUTO_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [automaticCheckReady, canStartDiscovery, runScheduledCheck]);

  useEffect(() => {
    if (!checkRetry.pending || !automaticCheckReady || !canStartDiscovery) {
      return;
    }
    const timer = window.setTimeout(runScheduledCheck, AUTO_CHECK_RETRY_MS);
    return () => window.clearTimeout(timer);
  }, [
    automaticCheckReady,
    canStartDiscovery,
    checkRetry.generation,
    checkRetry.pending,
    runScheduledCheck,
  ]);

  useEffect(() => {
    if (
      !installRetry.pending ||
      !autoUpdateEnabled ||
      !wsConnected ||
      !appReadyState.ready ||
      otaState.isInstallPending ||
      !shouldAutoInstallUpdate(autoUpdateEnabled, otaState.available)
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      setInstallRetry((prev) => ({ ...prev, pending: false }));
      startInstall(normalizeCurrentVersion(currentVersion));
    }, INSTALL_RETRY_MS);
    return () => window.clearTimeout(timer);
  }, [
    appReadyState.ready,
    autoUpdateEnabled,
    currentVersion,
    installRetry.generation,
    installRetry.pending,
    otaState.available,
    otaState.isInstallPending,
    startInstall,
    wsConnected,
  ]);

  useEffect(
    () => () => {
      clearCheckTimeout();
      clearInstallTimeout();
      clearActiveRecoveryTimeout();
    },
    [clearActiveRecoveryTimeout, clearCheckTimeout, clearInstallTimeout],
  );

  return (
    <OTAContext.Provider
      value={{
        ...otaState,
        clearOtaProgress,
        requestCheck,
        requestInstall,
        dismissError,
      }}
    >
      {children}
    </OTAContext.Provider>
  );
}

export function useOTA(): OTAContextValue {
  const context = useContext(OTAContext);
  if (!context) {
    throw new Error("useOTA must be used within OTAProvider");
  }
  return context;
}
