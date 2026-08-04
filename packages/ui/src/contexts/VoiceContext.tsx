import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import type { MutableRefObject } from "react";
import {
  addGlobalWsListener,
  sendNocturneWsRequest,
} from "../hooks/useNocturned";
import {
  AI_TIMEOUT_MS,
  CAPTURE_TIMEOUT_MS,
  FAST_PLAY_TOOLS,
  IDLE_CLOSE_TIMEOUT_MS,
  NO_ICON_INTENTS,
  OVERLAY_FADE_MS,
  PLAY_CLOSE_MS,
  POST_STREAM_CLOSE_MS,
  SPEAKING_TIMEOUT_MS,
  TERMINAL_CLOSE_MS,
  TERMINAL_TOOLS,
  VOLUME_INTENT,
  deriveSimpleIntent,
} from "../components/common/overlays/voice/constants";
import { useSettings } from "./SettingsContext";
import type { ChildrenProps, UnknownRecord, WsMessage } from "../types";
import type {
  AudioLevelEvent,
  AudioRecordStartRequest,
  AudioRecordStopRequest,
} from "@schema/audio";

type VoicePhase =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "confirmation"
  | "volume"
  | "error"
  | "closing";

interface VoicePayload extends UnknownRecord {
  action?: string;
  args?: UnknownRecord;
  code?: string;
  isFinal?: boolean;
  is_final?: boolean;
  level?: number;
  message?: string;
  response?: string;
  sessionId?: string;
  session_id?: string;
  state?: string;
  text?: string;
  tool?: string;
  toolArguments?: UnknownRecord;
  tool_arguments?: UnknownRecord;
  toolName?: string;
  tool_name?: string;
  transcript?: string;
  volume?: number;
  volume_percent?: number;
}

interface VoiceState {
  isOpen: boolean;
  phase: VoicePhase;
  transcript: string;
  isFinal: boolean;
  aiResponse: string;
  intent: string | null;
  action: string | null;
  confirmationText: { title: string; subtitle?: string } | null;
  volumeTarget: number | null;
  error: string | null;
  friendlyError: string;
  micLevel: number;
  currentSessionId: string | null;
  rejectedSessionIds: string[];
  streamCompleteAt: number | null;
}

type VoiceAction =
  | { type: "WAKEWORD_DETECTED" }
  | { type: "TRANSCRIPT_UPDATE"; payload?: VoicePayload }
  | { type: "AI_STATE_CHANGE"; payload?: VoicePayload }
  | { type: "AI_RESPONSE"; payload?: VoicePayload }
  | { type: "TOOL_EXECUTED"; payload?: VoicePayload }
  | { type: "SET_VOLUME"; payload: number }
  | { type: "MIC_LEVEL"; payload: number }
  | { type: "OPEN" }
  | { type: "CLOSE" }
  | { type: "OPEN_FALSE" }
  | { type: "REJECT_SESSION"; payload?: string | null }
  | { type: "SET_ERROR"; payload?: VoicePayload }
  | { type: "RESET" }
  | { type: "STREAM_COMPLETE" };

interface VoiceContextValue {
  state: VoiceState;
  actions: {
    open: () => void;
    close: () => void;
    cancel: () => void;
    retry: () => void;
    resetSession: () => void;
    pushMicLevel: (level: number) => void;
    applyTranscript: (data: VoicePayload) => void;
    applyAiState: (data: VoicePayload) => void;
    applyAiResponse: (data: VoicePayload) => void;
    applyToolExecuted: (data: VoicePayload) => void;
    streamComplete: () => void;
  };
  micLevelRef: MutableRefObject<number>;
}

const initialState: VoiceState = {
  isOpen: false,
  phase: "idle",
  transcript: "",
  isFinal: false,
  aiResponse: "",
  intent: null,
  action: null,
  confirmationText: null,
  volumeTarget: null,
  error: null,
  friendlyError: "",
  micLevel: 0,
  currentSessionId: null,
  rejectedSessionIds: [],
  streamCompleteAt: null,
};

const AUDIO_RECORD_START_REQUEST: AudioRecordStartRequest = {};
const AUDIO_RECORD_STOP_REQUEST: AudioRecordStopRequest = {};

export function getInitialState(): VoiceState {
  return {
    ...initialState,
    rejectedSessionIds: [...initialState.rejectedSessionIds],
  };
}

const TERMINAL_PHASES = new Set<VoicePhase>([
  "confirmation",
  "volume",
  "error",
  "closing",
]);

const REJECTED_SESSION_CAP = 20;

const STREAM_COMPLETE = "STREAM_COMPLETE" as const;

const voiceSessionId = (payload?: VoicePayload) =>
  payload?.session_id || payload?.sessionId || null;

const isFinalVoicePayload = (payload?: VoicePayload) =>
  !!(payload?.is_final ?? payload?.isFinal);

const aiResponseText = (payload?: VoicePayload) =>
  payload?.message || payload?.text || payload?.response || "";

const voiceToolName = (payload?: VoicePayload) =>
  payload?.tool || payload?.tool_name || payload?.toolName || "";

const voiceToolArguments = (payload?: VoicePayload) =>
  payload?.tool_arguments || payload?.toolArguments || payload?.args || {};

export function voiceReducer(
  state: VoiceState,
  action: VoiceAction,
): VoiceState {
  switch (action.type) {
    case "WAKEWORD_DETECTED":
      return {
        ...state,
        isOpen: true,
        phase: "listening",
        transcript: "",
        isFinal: false,
        aiResponse: "",
        intent: null,
        action: null,
        confirmationText: null,
        volumeTarget: null,
        error: null,
        friendlyError: "",
        micLevel: 0,
        currentSessionId: null,
      };

    case "TRANSCRIPT_UPDATE": {
      const payload = action.payload || {};
      const sessionId = voiceSessionId(payload);
      if (sessionId && state.rejectedSessionIds.includes(sessionId)) {
        return state;
      }
      let nextSessionId = state.currentSessionId;
      if (nextSessionId === null && sessionId) {
        nextSessionId = sessionId;
      }
      return {
        ...state,
        transcript: payload.transcript || "",
        isFinal: isFinalVoicePayload(payload),
        currentSessionId: nextSessionId,
      };
    }

    case "AI_STATE_CHANGE": {
      const payload = action.payload || {};
      const aiState = payload.state;
      let nextPhase = state.phase;
      if (aiState === "thinking" || aiState === "executing_tool") {
        nextPhase = "thinking";
      } else if (aiState === "speaking") {
        nextPhase = "speaking";
      } else if (aiState === "idle") {
        if (!TERMINAL_PHASES.has(state.phase)) {
          nextPhase = "idle";
        }
      }
      return { ...state, phase: nextPhase };
    }

    case "AI_RESPONSE": {
      const payload = action.payload || {};
      return {
        ...state,
        aiResponse: aiResponseText(payload),
        error: null,
        friendlyError: "",
      };
    }

    case "TOOL_EXECUTED": {
      const { intent, action: act } = action.payload || {};
      return {
        ...state,
        phase: "confirmation",
        intent: intent || null,
        action: act || null,
        confirmationText:
          intent && NO_ICON_INTENTS.has(intent) ? null : state.confirmationText,
      };
    }

    case "SET_VOLUME":
      return { ...state, volumeTarget: action.payload, phase: "volume" };

    case "MIC_LEVEL":
      return { ...state, micLevel: action.payload };

    case "OPEN":
      return { ...state, isOpen: true, phase: "listening" };

    case "CLOSE":
      return { ...state, phase: "closing" };

    case "OPEN_FALSE":
      return { ...state, isOpen: false, phase: "idle" };

    case "REJECT_SESSION": {
      const sessionId = action.payload;
      if (!sessionId) return state;
      if (state.rejectedSessionIds.includes(sessionId)) return state;
      const next = [...state.rejectedSessionIds, sessionId];
      if (next.length > REJECTED_SESSION_CAP) {
        next.splice(0, next.length - REJECTED_SESSION_CAP);
      }
      return { ...state, rejectedSessionIds: next };
    }

    case "SET_ERROR": {
      const payload = action.payload || {};
      return {
        ...state,
        phase: "error",
        error: payload.code,
        friendlyError: payload.message || "",
      };
    }

    case "RESET":
      return {
        ...initialState,
        isOpen: state.isOpen,
        phase: state.phase,
        rejectedSessionIds: [...state.rejectedSessionIds],
      };

    case STREAM_COMPLETE: {
      if (state.phase !== "speaking" && state.phase !== "confirmation") {
        return state;
      }
      return { ...state, streamCompleteAt: Date.now() };
    }

    default:
      return state;
  }
}

const VoiceContext = createContext<VoiceContextValue | null>(null);

export function VoiceProvider({
  children,
  suppressed = false,
}: ChildrenProps & { suppressed?: boolean }) {
  const { settings } = useSettings();
  const [state, dispatch] = useReducer(voiceReducer, getInitialState());
  const stateRef = useRef(state);
  const captureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamCompleteAtRef = useRef<number | null>(null);
  const micSmoothedRef = useRef(0);
  const pendingSessionRejectionRef = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    streamCompleteAtRef.current = state.streamCompleteAt;
  }, [state.streamCompleteAt]);

  const clearCaptureTimeout = () => {
    if (captureTimerRef.current) {
      clearTimeout(captureTimerRef.current);
      captureTimerRef.current = null;
    }
  };

  const clearAiTimeout = () => {
    if (aiTimerRef.current) {
      clearTimeout(aiTimerRef.current);
      aiTimerRef.current = null;
    }
  };

  const clearSpeakingTimeout = () => {
    if (speakingTimerRef.current) {
      clearTimeout(speakingTimerRef.current);
      speakingTimerRef.current = null;
    }
  };

  const clearCloseTimeout = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const scheduleClose = (ms: number) => {
    clearCloseTimeout();
    const scheduledAt = Date.now();
    closeTimerRef.current = setTimeout(() => {
      const streamAt = streamCompleteAtRef.current;
      if (streamAt !== null) {
        const extendedDeadline = streamAt + POST_STREAM_CLOSE_MS;
        const originalDeadline = scheduledAt + ms;
        if (extendedDeadline > originalDeadline) {
          const remaining = extendedDeadline - Date.now();
          if (remaining > 0) {
            scheduleClose(remaining);
            return;
          }
        }
      }
      dispatch({ type: "CLOSE" });
      closeTimerRef.current = setTimeout(() => {
        dispatch({ type: "RESET" });
        dispatch({ type: "OPEN_FALSE" });
        closeTimerRef.current = null;
      }, OVERLAY_FADE_MS);
    }, ms);
  };

  const startCaptureTimeout = () => {
    clearCaptureTimeout();
    captureTimerRef.current = setTimeout(() => {
      pendingSessionRejectionRef.current = true;
      dispatch({
        type: "SET_ERROR",
        payload: {
          code: "CAPTURE_TIMEOUT",
          message: "Sorry, I didn't catch that.",
        },
      });
      scheduleClose(IDLE_CLOSE_TIMEOUT_MS);
    }, CAPTURE_TIMEOUT_MS);
  };

  const startAiTimeout = () => {
    clearAiTimeout();
    aiTimerRef.current = setTimeout(() => {
      pendingSessionRejectionRef.current = true;
      dispatch({
        type: "SET_ERROR",
        payload: {
          code: "AI_TIMEOUT",
          message: "Sorry, something went wrong.",
        },
      });
      scheduleClose(IDLE_CLOSE_TIMEOUT_MS);
    }, AI_TIMEOUT_MS);
  };

  const startSpeakingTimeout = () => {
    clearSpeakingTimeout();
    speakingTimerRef.current = setTimeout(() => {
      speakingTimerRef.current = null;
      dispatch({ type: "AI_STATE_CHANGE", payload: { state: "idle" } });
      clearAiTimeout();
      scheduleClose(IDLE_CLOSE_TIMEOUT_MS);
    }, SPEAKING_TIMEOUT_MS);
  };

  const rejectCurrentSession = () => {
    const currentSessionId = stateRef.current.currentSessionId;
    if (currentSessionId) {
      dispatch({ type: "REJECT_SESSION", payload: currentSessionId });
    }
  };

  const isStaleEvent = (payload: VoicePayload) => {
    const sid = voiceSessionId(payload);
    if (!sid) return false;
    const currentState = stateRef.current;
    if (currentState.rejectedSessionIds.includes(sid)) return true;
    if (
      currentState.currentSessionId &&
      currentState.currentSessionId !== sid
    ) {
      return true;
    }
    return false;
  };

  const handleLateArrivalAfterDismissal = (payload: VoicePayload) => {
    if (!pendingSessionRejectionRef.current) return false;
    const sid = voiceSessionId(payload);
    if (!sid) return false;
    if (!stateRef.current.rejectedSessionIds.includes(sid)) {
      dispatch({ type: "REJECT_SESSION", payload: sid });
    }
    pendingSessionRejectionRef.current = false;
    return true;
  };

  const sendVoiceCommand = (method: string, params: UnknownRecord = {}) => {
    return sendNocturneWsRequest(method, params);
  };

  useEffect(() => {
    const handleMessage = (data: WsMessage) => {
      if (data.type !== "event") return;

      const { topic } = data;
      const payload: VoicePayload =
        data.data && typeof data.data === "object"
          ? (data.data as VoicePayload)
          : {};

      if (topic === "voice.wakeword") {
        if (settings.micMuted || suppressed) return;
        rejectCurrentSession();
        micSmoothedRef.current = 0;
        streamCompleteAtRef.current = null;
        pendingSessionRejectionRef.current = false;
        clearSpeakingTimeout();
        dispatch({ type: "WAKEWORD_DETECTED" });
        startCaptureTimeout();
        return;
      }

      if (topic === "voice.transcription") {
        if (handleLateArrivalAfterDismissal(payload)) return;
        if (isStaleEvent(payload)) return;
        dispatch({ type: "TRANSCRIPT_UPDATE", payload });
        clearCaptureTimeout();
        if (isFinalVoicePayload(payload)) {
          startAiTimeout();
        } else {
          startCaptureTimeout();
        }
        return;
      }

      if (topic === "ai.state") {
        if (handleLateArrivalAfterDismissal(payload)) return;
        if (isStaleEvent(payload)) return;
        dispatch({ type: "AI_STATE_CHANGE", payload });

        if (
          payload.state === "thinking" ||
          payload.state === "executing_tool"
        ) {
          clearSpeakingTimeout();
          clearCaptureTimeout();
          clearCloseTimeout();
          startAiTimeout();
        } else if (payload.state === "speaking") {
          startSpeakingTimeout();
        } else if (payload.state === "idle") {
          clearSpeakingTimeout();
          clearAiTimeout();
          scheduleClose(IDLE_CLOSE_TIMEOUT_MS);
        }
        return;
      }

      if (topic === "ai.response") {
        if (handleLateArrivalAfterDismissal(payload)) return;
        if (isStaleEvent(payload)) return;
        clearAiTimeout();
        dispatch({ type: "AI_RESPONSE", payload });
        const currentState = stateRef.current;
        if (
          currentState.phase === "confirmation" &&
          currentState.intent &&
          NO_ICON_INTENTS.has(currentState.intent)
        ) {
          scheduleClose(POST_STREAM_CLOSE_MS);
        }
        return;
      }

      if (topic === "ai.tool_executed") {
        if (handleLateArrivalAfterDismissal(payload)) return;
        if (isStaleEvent(payload)) return;

        const tool = voiceToolName(payload);
        const args = voiceToolArguments(payload);
        const intent = deriveSimpleIntent(tool, args);

        clearAiTimeout();
        clearCloseTimeout();

        dispatch({
          type: "TOOL_EXECUTED",
          payload: {
            intent,
            action: args.action,
            noIcon: intent ? NO_ICON_INTENTS.has(intent) : false,
          },
        });

        if (intent === VOLUME_INTENT) {
          dispatch({
            type: "SET_VOLUME",
            payload: args.volume_percent ?? args.volume ?? 0,
          });
        }

        if (FAST_PLAY_TOOLS.has(tool)) {
          scheduleClose(PLAY_CLOSE_MS);
        } else if (TERMINAL_TOOLS.has(tool)) {
          scheduleClose(TERMINAL_CLOSE_MS);
        }
        return;
      }

      if (topic === "audio.level") {
        const currentState = stateRef.current;
        if (!currentState.isOpen || currentState.phase !== "listening") return;

        const audioLevel = payload as AudioLevelEvent;
        const raw = typeof audioLevel.level === "number" ? audioLevel.level : 0;
        micSmoothedRef.current =
          micSmoothedRef.current + 0.3 * (raw - micSmoothedRef.current);
      }
    };

    const cleanup = addGlobalWsListener("voiceContext", {
      onMessage: handleMessage,
    });

    return cleanup;
  }, [settings.micMuted, suppressed]);

  useEffect(() => {
    if (suppressed && stateRef.current.isOpen) {
      actions.cancel();
    }
  }, [suppressed]);

  useEffect(() => {
    if (!state.isOpen) return;

    const handleKeydown = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" ||
        e.key === "ArrowLeft" ||
        e.key === "Backspace" ||
        e.keyCode === 8
      ) {
        e.stopPropagation();
        e.preventDefault();
        actions.cancel();
      }
    };

    window.addEventListener("keydown", handleKeydown, true);

    return () => {
      window.removeEventListener("keydown", handleKeydown, true);
    };
  }, [state.isOpen]);

  useEffect(() => {
    return () => {
      clearCaptureTimeout();
      clearAiTimeout();
      clearSpeakingTimeout();
      clearCloseTimeout();
    };
  }, []);

  const actions = useMemo(
    () => ({
      open: () => dispatch({ type: "OPEN" }),
      close: () => {
        rejectCurrentSession();
        pendingSessionRejectionRef.current = true;
        clearCaptureTimeout();
        clearAiTimeout();
        clearSpeakingTimeout();
        clearCloseTimeout();
        dispatch({ type: "CLOSE" });
        closeTimerRef.current = setTimeout(() => {
          dispatch({ type: "RESET" });
          dispatch({ type: "OPEN_FALSE" });
          closeTimerRef.current = null;
        }, OVERLAY_FADE_MS);
      },
      cancel: () => {
        rejectCurrentSession();
        pendingSessionRejectionRef.current = true;
        sendVoiceCommand("audio.record.stop", AUDIO_RECORD_STOP_REQUEST).catch(
          (err) => {
            console.warn("Failed to stop voice recording:", err);
          },
        );
        sendVoiceCommand("voice.cancel", {}).catch((err) => {
          console.warn("Failed to cancel voice session:", err);
        });
        clearCaptureTimeout();
        clearAiTimeout();
        clearSpeakingTimeout();
        clearCloseTimeout();
        dispatch({ type: "CLOSE" });
        closeTimerRef.current = setTimeout(() => {
          dispatch({ type: "RESET" });
          dispatch({ type: "OPEN_FALSE" });
          closeTimerRef.current = null;
        }, OVERLAY_FADE_MS);
      },
      retry: () => {
        rejectCurrentSession();
        clearCaptureTimeout();
        clearAiTimeout();
        clearSpeakingTimeout();
        clearCloseTimeout();
        sendVoiceCommand("audio.record.start", AUDIO_RECORD_START_REQUEST);
        dispatch({ type: "RESET" });
        dispatch({ type: "OPEN" });
        startCaptureTimeout();
      },
      resetSession: () => dispatch({ type: "RESET" }),
      pushMicLevel: (level: number) =>
        dispatch({ type: "MIC_LEVEL", payload: level }),
      applyTranscript: (data: VoicePayload) =>
        dispatch({ type: "TRANSCRIPT_UPDATE", payload: data }),
      applyAiState: (data: VoicePayload) =>
        dispatch({ type: "AI_STATE_CHANGE", payload: data }),
      applyAiResponse: (data: VoicePayload) =>
        dispatch({ type: "AI_RESPONSE", payload: data }),
      applyToolExecuted: (data: VoicePayload) =>
        dispatch({ type: "TOOL_EXECUTED", payload: data }),
      streamComplete: () => dispatch({ type: STREAM_COMPLETE }),
    }),
    [],
  );

  const value = useMemo(
    () => ({ state, actions, micLevelRef: micSmoothedRef }),
    [state, actions],
  );

  return (
    <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>
  );
}

export function useVoice() {
  const ctx = useContext(VoiceContext);
  if (!ctx) {
    throw new Error("useVoice must be used within VoiceProvider");
  }
  const { state, actions, micLevelRef } = ctx;
  const isError = !!state.error || !!state.friendlyError;
  return { state, isError, actions, micLevelRef };
}
