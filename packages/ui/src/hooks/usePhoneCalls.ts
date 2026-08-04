import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type {
  PhoneCallStartedEvent,
  PhoneCallUpdatedEvent,
  PhoneCallsGetResponse,
} from "@schema/phone";
import { addGlobalWsListener, sendNocturneWsRequest } from "./useNocturned";
import type { UnknownRecord, WsMessage } from "../types";

export type PhoneCall = PhoneCallStartedEvent | PhoneCallUpdatedEvent;
export type PhoneCallAction = "accept" | "decline";
export type PendingPhoneCallAction = {
  callKey: string;
  action: PhoneCallAction;
};

export type PhoneCallOverlayProps = {
  call: PhoneCall | null;
  pendingAction: PendingPhoneCallAction | null;
  error: string | null;
  onAccept: () => void | Promise<boolean>;
  onDecline: () => void | Promise<boolean>;
};

export type PhoneCallState = {
  calls: Record<string, PhoneCall>;
  order: string[];
};

type PhoneCallStateAction =
  | { type: "replace"; calls: PhoneCall[] }
  | { type: "upsert"; call: PhoneCall }
  | { type: "remove"; callId: string; device: string }
  | { type: "clear" };

const EMPTY_STATE: PhoneCallState = { calls: {}, order: [] };
const ACTION_REQUEST_TIMEOUT_MS = 5000;
const ACTION_SETTLE_TIMEOUT_MS = 10000;

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" ? (value as UnknownRecord) : null;

const readString = (
  value: UnknownRecord,
  camelKey: string,
  snakeKey = camelKey,
) => {
  const candidate = value[camelKey] ?? value[snakeKey];
  return typeof candidate === "string" ? candidate : null;
};

export const phoneCallKey = (call: Pick<PhoneCall, "device" | "callId">) =>
  `${call.device}:${call.callId}`;

export const normalizePhoneCall = (value: unknown): PhoneCall | null => {
  const call = asRecord(value);
  if (!call) return null;

  const callId = readString(call, "callId", "call_id");
  const device = readString(call, "device");
  const status = readString(call, "status");
  const direction = readString(call, "direction");
  if (!callId || !device || !status || !direction) return null;

  const label = readString(call, "label");
  const service = readString(call, "service");
  const startedAt = call.startedAtUnixS ?? call.started_at_unix_s;

  return {
    callId,
    device,
    remoteId: readString(call, "remoteId", "remote_id") ?? "",
    displayName: readString(call, "displayName", "display_name") ?? "",
    status,
    direction,
    ...(label ? { label } : {}),
    ...(service ? { service } : {}),
    ...(typeof startedAt === "number" ? { startedAtUnixS: startedAt } : {}),
  };
};

export const phoneCallReducer = (
  state: PhoneCallState,
  action: PhoneCallStateAction,
): PhoneCallState => {
  if (action.type === "clear") return EMPTY_STATE;

  if (action.type === "replace") {
    const calls: Record<string, PhoneCall> = {};
    const order: string[] = [];
    action.calls.forEach((call) => {
      const key = phoneCallKey(call);
      calls[key] = call;
      order.push(key);
    });
    return { calls, order };
  }

  if (action.type === "remove") {
    const key = `${action.device}:${action.callId}`;
    if (!state.calls[key]) return state;
    const calls = { ...state.calls };
    delete calls[key];
    return {
      calls,
      order: state.order.filter((candidate) => candidate !== key),
    };
  }

  const key = phoneCallKey(action.call);
  return {
    calls: { ...state.calls, [key]: action.call },
    order: state.calls[key] ? state.order : [...state.order, key],
  };
};

export const selectIncomingCall = (state: PhoneCallState): PhoneCall | null => {
  for (let index = state.order.length - 1; index >= 0; index -= 1) {
    const call = state.calls[state.order[index]];
    if (call?.direction === "incoming" && call.status === "ringing") {
      return call;
    }
  }
  return null;
};

export const selectPresentedPhoneCall = (
  call: PhoneCall | null,
  enabled: boolean,
) => (enabled ? call : null);

export const beginPhoneCallAction = (
  pending: PendingPhoneCallAction | null,
  call: PhoneCall,
  action: PhoneCallAction,
): PendingPhoneCallAction | null =>
  pending ? null : { callKey: phoneCallKey(call), action };

export const isCurrentPhoneCallAction = (
  current: PendingPhoneCallAction | null,
  candidate: PendingPhoneCallAction,
) => current === candidate;

export const shouldRefreshPhoneCallSnapshot = (message: WsMessage) => {
  if (message.type !== "event" || message.topic !== "app.ready") return false;
  const ready = asRecord(message.data);
  const platform = ready ? readString(ready, "platform") : null;
  return platform === "android" || platform === "ios";
};

const normalizeSnapshot = (response: PhoneCallsGetResponse | unknown) => {
  const snapshot = asRecord(response);
  const calls = snapshot?.calls;
  if (!Array.isArray(calls)) return [];
  return calls
    .map(normalizePhoneCall)
    .filter((call): call is PhoneCall => call !== null);
};

export function usePhoneCalls() {
  const [state, dispatch] = useReducer(phoneCallReducer, EMPTY_STATE);
  const [pendingAction, setPendingAction] =
    useState<PendingPhoneCallAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<PendingPhoneCallAction | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updatePending = useCallback(
    (pending: PendingPhoneCallAction | null) => {
      pendingRef.current = pending;
      setPendingAction(pending);
    },
    [],
  );

  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  const clearPending = useCallback(() => {
    clearSettleTimer();
    updatePending(null);
  }, [clearSettleTimer, updatePending]);

  const requestSnapshot = useCallback(
    async (device: string) => {
      const response = await sendNocturneWsRequest<PhoneCallsGetResponse>(
        "phone.calls.get",
        { device },
        { timeoutMs: ACTION_REQUEST_TIMEOUT_MS },
      );
      const calls = normalizeSnapshot(response);
      dispatch({ type: "replace", calls });
      const pending = pendingRef.current;
      if (
        pending &&
        !calls.some(
          (call) =>
            phoneCallKey(call) === pending.callKey && call.status === "ringing",
        )
      ) {
        clearPending();
      }
      if (
        !calls.some(
          (call) => call.direction === "incoming" && call.status === "ringing",
        )
      ) {
        setError(null);
      }
    },
    [clearPending],
  );

  useEffect(() => {
    const requestCurrentDevice = () => {
      const device = localStorage.getItem("lastConnectedBluetoothDevice");
      if (!device) return;
      requestSnapshot(device).catch(() => {
        dispatch({ type: "clear" });
      });
    };

    const removeListener = addGlobalWsListener("native-phone-calls", {
      onClose: () => {
        clearPending();
        setError(null);
        dispatch({ type: "clear" });
      },
      onMessage: (message: WsMessage) => {
        if (message.type !== "event") return;

        if (shouldRefreshPhoneCallSnapshot(message)) {
          requestCurrentDevice();
          return;
        }

        if (
          message.topic === "phone.call.started" ||
          message.topic === "phone.call.updated"
        ) {
          const call = normalizePhoneCall(message.data);
          if (!call) return;
          if (message.topic === "phone.call.started") setError(null);
          dispatch({ type: "upsert", call });
          if (
            pendingRef.current?.callKey === phoneCallKey(call) &&
            call.status !== "ringing"
          ) {
            clearPending();
          }
          return;
        }

        if (message.topic === "phone.call.ended") {
          const ended = asRecord(message.data);
          if (!ended) return;
          const callId = readString(ended, "callId", "call_id");
          const device = readString(ended, "device");
          if (!callId || !device) return;
          dispatch({ type: "remove", callId, device });
          if (pendingRef.current?.callKey === `${device}:${callId}`) {
            clearPending();
          }
          setError(null);
        }
      },
    });

    return () => {
      removeListener();
      clearSettleTimer();
    };
  }, [clearPending, clearSettleTimer, requestSnapshot]);

  const incomingCall = useMemo(() => {
    const pendingCall = pendingAction
      ? state.calls[pendingAction.callKey]
      : null;
    if (
      pendingCall?.direction === "incoming" &&
      pendingCall.status === "ringing"
    ) {
      return pendingCall;
    }
    return selectIncomingCall(state);
  }, [pendingAction, state]);

  const performAction = useCallback(
    async (action: PhoneCallAction, call: PhoneCall | null) => {
      if (!call) return false;
      const pending = beginPhoneCallAction(pendingRef.current, call, action);
      if (!pending) return false;

      clearSettleTimer();
      setError(null);
      updatePending(pending);
      try {
        await sendNocturneWsRequest(
          action === "accept" ? "phone.call.accept" : "phone.call.decline",
          { call_id: call.callId, device: call.device },
          { timeoutMs: ACTION_REQUEST_TIMEOUT_MS },
        );
        if (!isCurrentPhoneCallAction(pendingRef.current, pending)) {
          return true;
        }
        settleTimerRef.current = setTimeout(() => {
          if (isCurrentPhoneCallAction(pendingRef.current, pending)) {
            updatePending(null);
            setError("The phone did not confirm the call action. Try again.");
          }
        }, ACTION_SETTLE_TIMEOUT_MS);
        return true;
      } catch (actionError) {
        if (!isCurrentPhoneCallAction(pendingRef.current, pending)) {
          return false;
        }
        clearPending();
        setError(
          actionError instanceof Error
            ? actionError.message
            : "The call action failed. Try again.",
        );
        return false;
      }
    },
    [clearPending, clearSettleTimer, updatePending],
  );

  const accept = useCallback(
    () => performAction("accept", incomingCall),
    [incomingCall, performAction],
  );
  const decline = useCallback(
    () => performAction("decline", incomingCall),
    [incomingCall, performAction],
  );

  return { incomingCall, pendingAction, error, accept, decline };
}
