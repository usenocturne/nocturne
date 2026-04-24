import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
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

const initialState = {
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

export function getInitialState() {
  return {
    ...initialState,
    rejectedSessionIds: [...initialState.rejectedSessionIds],
  };
}

const TERMINAL_PHASES = new Set(["confirmation", "volume", "error", "closing"]);

const REJECTED_SESSION_CAP = 20;

const STREAM_COMPLETE = "STREAM_COMPLETE";

export function voiceReducer(state, action) {
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
      const sessionId = payload.session_id;
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
        isFinal: !!payload.is_final,
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
        aiResponse: payload.text || payload.response || "",
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

const VoiceContext = createContext(null);

export function VoiceProvider({ children, suppressed = false }) {
  const { settings } = useSettings();
  const [state, dispatch] = useReducer(voiceReducer, getInitialState());
  const stateRef = useRef(state);
  const captureTimerRef = useRef(null);
  const aiTimerRef = useRef(null);
  const speakingTimerRef = useRef(null);
  const closeTimerRef = useRef(null);
  const streamCompleteAtRef = useRef(null);
  const micSmoothedRef = useRef(0);

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

  const scheduleClose = (ms) => {
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

  const isStaleEvent = (payload) => {
    const sid = payload?.session_id;
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

  const sendVoiceCommand = (method, params = {}) => {
    return sendNocturneWsRequest(method, params);
  };

  useEffect(() => {
    const handleMessage = (data) => {
      if (data.type !== "event") return;

      const { topic } = data;
      const payload = data.data || {};

      if (topic === "voice.wakeword") {
        if (settings.micMuted || suppressed) return;
        rejectCurrentSession();
        micSmoothedRef.current = 0;
        streamCompleteAtRef.current = null;
        clearSpeakingTimeout();
        dispatch({ type: "WAKEWORD_DETECTED" });
        startCaptureTimeout();
        return;
      }

      if (topic === "voice.transcription") {
        if (isStaleEvent(payload)) return;
        dispatch({ type: "TRANSCRIPT_UPDATE", payload });
        clearCaptureTimeout();
        if (payload.is_final) {
          startAiTimeout();
        } else {
          startCaptureTimeout();
        }
        return;
      }

      if (topic === "ai.state") {
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
        if (isStaleEvent(payload)) return;

        const tool = payload.tool || payload.tool_name || "";
        const args = payload.tool_arguments || payload.args || {};
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

        const raw = typeof payload.level === "number" ? payload.level : 0;
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

    const handleKeydown = (e) => {
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
        sendVoiceCommand("audio.record.stop", {});
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
        sendVoiceCommand("audio.record.start", {});
        dispatch({ type: "RESET" });
        dispatch({ type: "OPEN" });
        startCaptureTimeout();
      },
      resetSession: () => dispatch({ type: "RESET" }),
      pushMicLevel: (level) => dispatch({ type: "MIC_LEVEL", payload: level }),
      applyTranscript: (data) =>
        dispatch({ type: "TRANSCRIPT_UPDATE", payload: data }),
      applyAiState: (data) =>
        dispatch({ type: "AI_STATE_CHANGE", payload: data }),
      applyAiResponse: (data) =>
        dispatch({ type: "AI_RESPONSE", payload: data }),
      applyToolExecuted: (data) =>
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
