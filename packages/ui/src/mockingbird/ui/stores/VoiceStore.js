import { makeAutoObservable, action } from "mobx";
import {
  addGlobalWsListener,
  sendNocturneWsRequest,
} from "../../../hooks/useNocturned";
import { DEFAULT_TIMEOUT_TO_NPV } from "./ViewStore";
import {
  SHUFFLE_ON_INTENT,
  SHUFFLE_OFF_INTENT,
  REPEAT_ON_INTENT,
  REPEAT_OFF_INTENT,
  REPEAT_ONE_INTENT,
  ADD_TO_COLLECTION_INTENT,
  PLAY_INTENT,
  STOP_INTENT,
  NEXT_INTENT,
  PREVIOUS_INTENT,
  SHOW_INTENT,
  ADD_TO_QUEUE_INTENT,
  BAN_TRACK_INTENT,
  VOLUME_INTENT,
  FOLLOW_INTENT,
  UNFOLLOW_INTENT,
} from "../components/Listening/VoiceConfirmationIntents";
import {
  normalizeSpotifySearchResult,
  isEmptyVoiceResult,
  normalizeRecentlyPlayedResult,
  isEmptyRecentlyPlayedResult,
} from "../helpers/voiceSearchNormalizer";

const CAPTURE_TIMEOUT = 18000;
const AI_TIMEOUT = 30000;
const TIMEOUT_BEFORE_CLOSING_LISTENING_MS = 2500;
const TERMINAL_CONFIRMATION_CLOSE_MS = 8000;
const OVERLAY_TRANSITION_DURATION_MS = 300;

const TERMINAL_TOOLS = new Set([
  "spotify_next",
  "spotify_previous",
  "spotify_pause",
  "spotify_volume",
  "spotify_save_track",
  "spotify_shuffle",
  "spotify_repeat",
  "spotify_add_to_queue",
  "spotify_remove_track",
  "spotify_follow",
  "spotify_unfollow",
]);

const NO_ICON_INTENTS = new Set([PLAY_INTENT]);

export const VOICE_RESULT_TOOL_HANDLERS = {
  spotify_search: {
    normalize: normalizeSpotifySearchResult,
    isEmpty: isEmptyVoiceResult,
  },
  spotify_get_recently_played: {
    normalize: normalizeRecentlyPlayedResult,
    isEmpty: isEmptyRecentlyPlayedResult,
  },
};
export const MINIMUM_THINKING_TIME_FOR_SEARCH_RESULT = 2000;
export const PLAY_TIMEOUT_TO_NPV = 10000;

function coerceBool(v) {
  if (v === true) return true;
  if (v === false) return false;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "on" || s === "1") return true;
    if (s === "false" || s === "off" || s === "0") return false;
  }
  if (typeof v === "number") return v !== 0;
  return null;
}

function deriveSimpleIntent(tool, args) {
  if (tool === "spotify_shuffle") {
    const b = coerceBool(args?.state);
    if (b === true) return SHUFFLE_ON_INTENT;
    if (b === false) return SHUFFLE_OFF_INTENT;
    return SHUFFLE_ON_INTENT;
  }
  if (tool === "spotify_shuffle_off") {
    return SHUFFLE_OFF_INTENT;
  }
  if (tool === "spotify_repeat") {
    const s =
      typeof args?.state === "string" ? args.state.trim().toLowerCase() : "";
    if (s === "off") return REPEAT_OFF_INTENT;
    if (s === "track" || s === "one") return REPEAT_ONE_INTENT;
    if (s === "context" || s === "all" || s === "on") return REPEAT_ON_INTENT;
    return REPEAT_ON_INTENT;
  }
  if (tool === "spotify_repeat_off") {
    return REPEAT_OFF_INTENT;
  }
  if (tool === "spotify_follow" || tool === "spotify_unfollow") {
    const uris = Array.isArray(args?.uris)
      ? args.uris
      : typeof args?.uri === "string"
        ? [args.uri]
        : [];
    if (uris.length === 0) return null;
    const allFollowable = uris.every(
      (u) =>
        typeof u === "string" &&
        (u.startsWith("spotify:artist:") || u.startsWith("spotify:show:")),
    );
    if (!allFollowable) return null;
    return tool === "spotify_follow" ? FOLLOW_INTENT : UNFOLLOW_INTENT;
  }
  const directMap = {
    spotify_save_track: ADD_TO_COLLECTION_INTENT,
    spotify_play: PLAY_INTENT,
    spotify_pause: STOP_INTENT,
    spotify_next: NEXT_INTENT,
    spotify_previous: PREVIOUS_INTENT,
    spotify_add_to_queue: ADD_TO_QUEUE_INTENT,
    spotify_remove_track: BAN_TRACK_INTENT,
    spotify_volume: VOLUME_INTENT,
  };
  return directMap[tool] || null;
}

function deriveVoiceResultIntent(toolArguments, toolsExecutedThisSession) {
  if (toolsExecutedThisSession.has("spotify_play")) {
    return PLAY_INTENT;
  }
  return SHOW_INTENT;
}

const getInitialVoiceSessionState = () => ({
  asr: {
    transcript: "",
    isFinal: false,
  },
  aiState: "idle",
  aiResponse: "",
  error: null,
  friendlyError: "",
  micPan: 0,
  intent: "",
  action: undefined,
  showingVoiceConfirmation: false,
  volumeTarget: null,
});

class VoiceStore {
  state = getInitialVoiceSessionState();
  micLevelMovingAverage = 0;
  isMicMuted = localStorage.getItem("mockingbird_mic_muted") === "true";
  microphoneLevelsSlidingWindow = [];
  currentSessionId = null;
  _wsCleanup = null;
  _captureTimeoutId = null;
  _aiTimeoutId = null;
  _closeTimeoutId = null;
  _micLevelIntervalId = null;
  _terminalAutoCloseActive = false;
  _rejectedSessionIds = new Set();
  _toolsExecutedThisSession = new Set();
  _pendingVoicePopulation = null;
  _aiSawExecutingTool = false;
  _voiceResultNavigateTimeoutId = null;
  _voiceResultResetTimeoutId = null;
  _pendingSessionRejection = false;

  constructor(rootStore, socket, middlewareActions) {
    this.rootStore = rootStore;
    makeAutoObservable(this, {
      rootStore: false,
      _wsCleanup: false,
      _captureTimeoutId: false,
      _aiTimeoutId: false,
      _closeTimeoutId: false,
      _micLevelIntervalId: false,
      _terminalAutoCloseActive: false,
      _rejectedSessionIds: false,
      _toolsExecutedThisSession: false,
      _pendingVoicePopulation: false,
      _aiSawExecutingTool: false,
      _voiceResultNavigateTimeoutId: false,
      _voiceResultResetTimeoutId: false,
      _pendingSessionRejection: false,
      _isStaleEvent: false,
      _rejectCurrentSession: false,
      _handleLateArrivalAfterDismissal: false,
      _discardPendingVoicePopulation: false,
      _resetVoiceTurnTracking: false,
      _clearVoiceResultTimers: false,
    });

    void socket;
    void middlewareActions;

    this._wsCleanup = addGlobalWsListener("voiceStore", {
      onMessage: action((event) => {
        if (event.type !== "event") return;
        const { topic, data } = event;
        if (topic === "voice.wakeword") this.onWakeWord();
        else if (topic === "voice.wakeword.state") this._onWakeWordState(data);
        else if (topic === "voice.transcription") this.onTranscription(data);
        else if (topic === "ai.state") this.onAIState(data);
        else if (topic === "ai.response") this.onAIResponse(data);
        else if (topic === "ai.tool_executed") this.onToolExecuted(data);
        else if (topic === "audio.level") this._onMicLevel(data);
      }),
    });
  }

  get listening() {
    return !this.state.asr.isFinal && !this.state.error;
  }

  get thinking() {
    return (
      this.state.asr.isFinal ||
      this.state.aiState === "thinking" ||
      this.state.aiState === "executing_tool"
    );
  }

  get error() {
    return this.state.error;
  }

  get isError() {
    return !!this.state.error || !!this.state.friendlyError;
  }

  get friendlyError() {
    return this.state.friendlyError || "";
  }

  get intent() {
    return this.state.intent || "";
  }

  get showingVoiceConfirmation() {
    return this.state.showingVoiceConfirmation && !!this.state.intent;
  }

  onWakeWord = action(() => {
    const { viewStore, overlayController } = this.rootStore;
    if (viewStore.appView !== "MAIN") return;
    if (this.isMicMuted) return;
    this._rejectCurrentSession();
    this._pendingSessionRejection = false;
    this.rootStore.shelfStore.clearVoiceItems();
    this._resetVoiceTurnTracking();
    this._clearVoiceResultTimers();
    this.resetVoiceSessionState();
    overlayController.showVoice();
    this._startCaptureTimeout();
  });

  _onWakeWordState = action((data) => {
    const muted = !!data?.muted;
    if (this.isMicMuted === muted) return;
    this.isMicMuted = muted;
    localStorage.setItem("mockingbird_mic_muted", String(muted));
  });

  onTranscription = action((data) => {
    if (this._handleLateArrivalAfterDismissal(data)) return;
    if (this._isStaleEvent(data, "transcription")) return;
    if (
      this.currentSessionId === null &&
      data.session_id &&
      !this._rejectedSessionIds.has(data.session_id)
    ) {
      this.currentSessionId = data.session_id;
    }

    this.state.asr.transcript = data.transcript || "";
    this.state.asr.isFinal = !!data.is_final;
    if (data.is_final) {
      this.micLevelMovingAverage = 0;
      this._clearCaptureTimeout();
      this._startAITimeout();
    } else {
      this._startCaptureTimeout();
    }
  });

  onAIState = action((data) => {
    if (this._handleLateArrivalAfterDismissal(data)) return;
    if (this._isStaleEvent(data, "ai")) return;

    const prevState = this.state.aiState;
    this.state.aiState = data.state || "idle";

    if (data.state === "executing_tool") {
      this._aiSawExecutingTool = true;
    }

    if (data.state === "thinking" || data.state === "executing_tool") {
      this._clearCaptureTimeout();
      this._clearCloseTimeout();
      this._startAITimeout();
    }

    const isSpeaking = data.state === "speaking";
    const isCleanIdle = data.state === "idle" && this._aiSawExecutingTool;

    if ((isSpeaking || isCleanIdle) && this._pendingVoicePopulation != null) {
      const pending = this._pendingVoicePopulation;
      const hasQueueMutation =
        this._toolsExecutedThisSession.has("spotify_add_to_queue") ||
        this._toolsExecutedThisSession.has("spotify_remove_track");

      if (!hasQueueMutation) {
        const intent = deriveVoiceResultIntent(
          pending.toolArguments,
          this._toolsExecutedThisSession,
        );

        this.rootStore.shelfStore.populateVoice({
          items: pending.voiceItems,
          id: "voice",
        });
        this.state.intent = intent;
        this.state.showingVoiceConfirmation = !NO_ICON_INTENTS.has(intent);
        this.goToVoiceResult(intent);
      }

      this._resetVoiceTurnTracking();
    }

    if (
      data.state === "idle" &&
      !this._pendingVoicePopulation &&
      (prevState === "speaking" ||
        prevState === "thinking" ||
        prevState === "executing_tool")
    ) {
      this._scheduleClose();
    }
  });

  onAIResponse = action((data) => {
    if (this._handleLateArrivalAfterDismissal(data)) return;
    if (this._isStaleEvent(data, "ai")) return;
    if (data.text) {
      this.state.aiResponse = data.text;
      this._clearAITimeout();
      this.micLevelMovingAverage = 0;
      this.state.showingVoiceConfirmation = false;
      this.state.error = null;
      this.state.friendlyError = "";
      if (this.state.aiState !== "idle") {
        this._clearCloseTimeout();
      }
    }
  });

  onToolExecuted = action((data) => {
    if (this._handleLateArrivalAfterDismissal(data)) return;
    if (this._isStaleEvent(data, "ai")) return;

    const tool = data.tool;
    this._toolsExecutedThisSession.add(tool);
    this._clearAITimeout();

    const handler = VOICE_RESULT_TOOL_HANDLERS[tool];
    if (handler) {
      this._handleVoiceResultTool(data, handler);
      return;
    }

    const intent = deriveSimpleIntent(tool, data.tool_arguments);
    if (intent) {
      this.state.intent = intent;
      this.state.showingVoiceConfirmation = !NO_ICON_INTENTS.has(intent);
      this.state.aiResponse = "";
      if (intent === VOLUME_INTENT) {
        const raw = Number(data?.tool_arguments?.volume_percent);
        this.state.volumeTarget = Number.isFinite(raw)
          ? Math.max(0, Math.min(100, Math.round(raw)))
          : null;
      }
    }

    if (TERMINAL_TOOLS.has(tool)) {
      this._discardPendingVoicePopulation();
    }
  });

  _handleVoiceResultTool = action((data, handler) => {
    const result = data.result;
    const toolArguments = data.tool_arguments;

    if (handler.isEmpty(result)) {
      this._discardPendingVoicePopulation();
      this.state.friendlyError = "Sorry, I couldn't find anything.";
      this._scheduleClose(TERMINAL_CONFIRMATION_CLOSE_MS);
      return;
    }

    const voiceItems = handler.normalize(result);
    this._pendingVoicePopulation = { voiceItems, toolArguments };
  });

  _onMicLevel = action((data) => {
    this.micLevelMovingAverage = data.level || 0;
  });

  retry = action(() => {
    this._rejectCurrentSession();
    this.rootStore.shelfStore.clearVoiceItems();
    this._resetVoiceTurnTracking();
    this._clearVoiceResultTimers();
    this._terminalAutoCloseActive = false;
    this.state.error = null;
    this.state.friendlyError = "";
    this.state.asr.transcript = "";
    this.state.asr.isFinal = false;
    this._clearCaptureTimeout();
    this._clearAITimeout();
    this._clearCloseTimeout();
    this._startCaptureTimeout();
    sendNocturneWsRequest("audio.record.start", {});
  });

  cancel = action(() => {
    this._rejectCurrentSession();
    this._pendingSessionRejection = true;
    this.rootStore.shelfStore.clearVoiceItems();
    this._resetVoiceTurnTracking();
    this._clearVoiceResultTimers();
    sendNocturneWsRequest("audio.record.stop", {});
    this.rootStore.overlayController.hideVoice();
    this._clearCaptureTimeout();
    this._clearAITimeout();
    this._clearCloseTimeout();
    this._stopSyntheticMicLevel();
    setTimeout(
      action(() => {
        this.resetVoiceSessionState();
      }),
      OVERLAY_TRANSITION_DURATION_MS,
    );
  });

  toggleMic = action(() => {
    this.isMicMuted = !this.isMicMuted;
    localStorage.setItem("mockingbird_mic_muted", String(this.isMicMuted));
    if (this.isMicMuted) {
      sendNocturneWsRequest("wakeword.pause", {});
    } else {
      sendNocturneWsRequest("wakeword.resume", {});
    }
  });

  resetVoiceSessionState = action(() => {
    this.state = getInitialVoiceSessionState();
    this.currentSessionId = null;
    this._terminalAutoCloseActive = false;
    this._clearCaptureTimeout();
    this._clearAITimeout();
    this._clearCloseTimeout();
    this._clearVoiceResultTimers();
    this._stopSyntheticMicLevel();
    this.micLevelMovingAverage = 0;
  });

  goToVoiceResult = action((intent) => {
    if (this.rootStore.shelfStore.voiceItems.length === 0) return;
    const isOnNpv = this.rootStore.viewStore.isNpv;

    const timeToNpv =
      intent === SHOW_INTENT ? DEFAULT_TIMEOUT_TO_NPV : PLAY_TIMEOUT_TO_NPV;

    this._clearVoiceResultTimers();

    this._voiceResultNavigateTimeoutId = setTimeout(
      action(() => {
        this.rootStore.overlayController.hideVoice();
        const shouldNavigateToShelf = !isOnNpv || intent === SHOW_INTENT;
        if (shouldNavigateToShelf) {
          this.rootStore.viewStore.backToContentShelf(
            timeToNpv + MINIMUM_THINKING_TIME_FOR_SEARCH_RESULT,
          );
          setTimeout(
            action(() => {
              this.rootStore.shelfStore.shelfController.headerUiState.selectedCategoryId =
                "voice";
              const items =
                this.rootStore.shelfStore.shelfController.swiperUiState
                  .allShelfItems;
              const firstVoiceIdx = items.findIndex(
                (it) => it.category === "voice" && it.type === "CONTEXT_ITEM",
              );
              if (firstVoiceIdx >= 0) {
                this.rootStore.shelfStore.shelfController.swiperUiState.selectedItemIndex =
                  firstVoiceIdx;
              }
              this._voiceResultNavigateTimeoutId = null;
            }),
            150,
          );
        } else {
          this._voiceResultNavigateTimeoutId = null;
        }
      }),
      MINIMUM_THINKING_TIME_FOR_SEARCH_RESULT,
    );

    const resetDelay = isOnNpv
      ? MINIMUM_THINKING_TIME_FOR_SEARCH_RESULT +
        OVERLAY_TRANSITION_DURATION_MS +
        500
      : MINIMUM_THINKING_TIME_FOR_SEARCH_RESULT +
        timeToNpv +
        MINIMUM_THINKING_TIME_FOR_SEARCH_RESULT;

    this._voiceResultResetTimeoutId = setTimeout(
      action(() => {
        this.resetVoiceSessionState();
        this._voiceResultResetTimeoutId = null;
      }),
      resetDelay,
    );
  });

  _isStaleEvent(data, channel) {
    if (!data.session_id) return false;
    if (this._rejectedSessionIds.has(data.session_id)) return true;
    if (
      this.currentSessionId !== null &&
      data.session_id !== this.currentSessionId
    ) {
      return true;
    }
    if (this.currentSessionId === null && channel === "ai") return true;
    return false;
  }

  _rejectCurrentSession() {
    if (this.currentSessionId == null) {
      return;
    }

    this._rejectedSessionIds.add(this.currentSessionId);
    if (this._rejectedSessionIds.size > 20) {
      const first = this._rejectedSessionIds.values().next().value;
      this._rejectedSessionIds.delete(first);
    }
    this.currentSessionId = null;
  }

  _handleLateArrivalAfterDismissal(data) {
    if (!this._pendingSessionRejection) return false;
    const sid = data?.session_id;
    if (!sid) return false;
    if (!this._rejectedSessionIds.has(sid)) {
      this._rejectedSessionIds.add(sid);
      if (this._rejectedSessionIds.size > 20) {
        const first = this._rejectedSessionIds.values().next().value;
        this._rejectedSessionIds.delete(first);
      }
    }
    this._pendingSessionRejection = false;
    return true;
  }

  _discardPendingVoicePopulation() {
    this._pendingVoicePopulation = null;
    this._aiSawExecutingTool = false;
  }

  _resetVoiceTurnTracking() {
    this._pendingVoicePopulation = null;
    this._aiSawExecutingTool = false;
    this._toolsExecutedThisSession.clear();
  }

  _clearVoiceResultTimers() {
    if (this._voiceResultNavigateTimeoutId) {
      clearTimeout(this._voiceResultNavigateTimeoutId);
      this._voiceResultNavigateTimeoutId = null;
    }
    if (this._voiceResultResetTimeoutId) {
      clearTimeout(this._voiceResultResetTimeoutId);
      this._voiceResultResetTimeoutId = null;
    }
  }

  _startCaptureTimeout() {
    this._clearCaptureTimeout();
    this._captureTimeoutId = setTimeout(
      action(() => {
        this._pendingSessionRejection = true;
        this.state.error = "error";
        this.state.friendlyError = "Something went wrong. Tap to try again.";
        this._stopSyntheticMicLevel();
        this._scheduleClose();
      }),
      CAPTURE_TIMEOUT,
    );
  }

  _clearCaptureTimeout() {
    if (this._captureTimeoutId) {
      clearTimeout(this._captureTimeoutId);
      this._captureTimeoutId = null;
    }
  }

  _startAITimeout() {
    this._clearAITimeout();
    this._aiTimeoutId = setTimeout(
      action(() => {
        this._pendingSessionRejection = true;
        this.state.error = "error";
        this.state.friendlyError = "Something went wrong. Tap to try again.";
        this._stopSyntheticMicLevel();
        this._scheduleClose();
      }),
      AI_TIMEOUT,
    );
  }

  _clearAITimeout() {
    if (this._aiTimeoutId) {
      clearTimeout(this._aiTimeoutId);
      this._aiTimeoutId = null;
    }
  }

  _scheduleClose(delayMs = TIMEOUT_BEFORE_CLOSING_LISTENING_MS) {
    this._clearCloseTimeout();
    this._closeTimeoutId = setTimeout(
      action(() => {
        this.rootStore.overlayController.hideVoice();
        setTimeout(
          action(() => {
            this.resetVoiceSessionState();
          }),
          OVERLAY_TRANSITION_DURATION_MS,
        );
      }),
      delayMs,
    );
  }

  _clearCloseTimeout() {
    if (this._closeTimeoutId) {
      clearTimeout(this._closeTimeoutId);
      this._closeTimeoutId = null;
    }
  }

  _startSyntheticMicLevel() {
    this._stopSyntheticMicLevel();
    this._micLevelIntervalId = setInterval(
      action(() => {
        this.micLevelMovingAverage = 0.3 + Math.sin(Date.now() / 300) * 0.2;
      }),
      50,
    );
  }

  _stopSyntheticMicLevel() {
    if (this._micLevelIntervalId) {
      clearInterval(this._micLevelIntervalId);
      this._micLevelIntervalId = null;
    }
    this.micLevelMovingAverage = 0;
  }

  dispose() {
    if (this._wsCleanup) {
      this._wsCleanup();
      this._wsCleanup = null;
    }
    this._clearCaptureTimeout();
    this._clearAITimeout();
    this._clearCloseTimeout();
    this._clearVoiceResultTimers();
    this._stopSyntheticMicLevel();
  }
}

export default VoiceStore;
