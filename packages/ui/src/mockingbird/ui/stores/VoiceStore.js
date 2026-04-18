import { makeAutoObservable, action } from "mobx";
import {
  addGlobalWsListener,
  sendNocturneWsRequest,
} from "../../../hooks/useNocturned";
import {
  SHUFFLE_ON_INTENT,
  SHUFFLE_OFF_INTENT,
  REPEAT_ON_INTENT,
  REPEAT_OFF_INTENT,
  ADD_TO_COLLECTION_INTENT,
  PLAY_INTENT,
  STOP_INTENT,
  NEXT_INTENT,
  PREVIOUS_INTENT,
} from "../components/Listening/VoiceConfirmationIntents";

const CAPTURE_TIMEOUT = 10000;
const AI_TIMEOUT = 30000;
const TIMEOUT_BEFORE_CLOSING_LISTENING_MS = 7500;
const TERMINAL_CONFIRMATION_CLOSE_MS = 1500;
const OVERLAY_TRANSITION_DURATION_MS = 300;

const TERMINAL_TOOLS = new Set([
  "spotify_next",
  "spotify_previous",
  "spotify_pause",
  "spotify_volume",
  "spotify_save_track",
  "spotify_shuffle",
  "spotify_repeat",
]);

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
});

class VoiceStore {
  state = getInitialVoiceSessionState();
  micLevelMovingAverage = 0;
  isMicMuted = localStorage.getItem("mockingbird_mic_muted") === "true";
  microphoneLevelsSlidingWindow = [];
  _wsCleanup = null;
  _captureTimeoutId = null;
  _aiTimeoutId = null;
  _closeTimeoutId = null;
  _micLevelIntervalId = null;
  _terminalAutoCloseActive = false;

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
    });

    void socket;
    void middlewareActions;

    this._wsCleanup = addGlobalWsListener("voiceStore", {
      onMessage: action((event) => {
        if (event.type !== "event") return;
        const { topic, data } = event;
        if (topic === "voice.wakeword") this.onWakeWord();
        else if (topic === "voice.transcription") this.onTranscription(data);
        else if (topic === "ai.state") this.onAIState(data);
        else if (topic === "ai.response") this.onAIResponse(data);
        else if (topic === "ai.tool_executed") this.onToolExecuted(data);
        else if (topic === "audio.level") this._onMicLevel(data);
      }),
    });

    if (this.isMicMuted) {
      sendNocturneWsRequest("wakeword.pause", {});
    }
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
    this.resetVoiceSessionState();
    overlayController.showVoice();
    this._startCaptureTimeout();
  });

  onTranscription = action((data) => {
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
    const prevState = this.state.aiState;
    this.state.aiState = data.state || "idle";
    if (this._terminalAutoCloseActive) return;
    if (data.state === "thinking" || data.state === "executing_tool") {
      this._clearCaptureTimeout();
      this._clearCloseTimeout();
      this._startAITimeout();
    }
    if (
      data.state === "idle" &&
      (prevState === "speaking" ||
        prevState === "thinking" ||
        prevState === "executing_tool")
    ) {
      this._scheduleClose();
    }
  });

  onAIResponse = action((data) => {
    if (this._terminalAutoCloseActive) return;
    this.state.aiResponse = data.text || "";
    this._clearAITimeout();
    this.micLevelMovingAverage = 0;
    if (data.text) {
      this.state.showingVoiceConfirmation = false;
      this.state.error = null;
      this.state.friendlyError = "";
      if (this.state.aiState !== "idle") {
        this._clearCloseTimeout();
      }
    }
  });

  onToolExecuted = action((data) => {
    const tool = data.tool;
    const intentMap = {
      spotify_shuffle: SHUFFLE_ON_INTENT,
      spotify_shuffle_off: SHUFFLE_OFF_INTENT,
      spotify_repeat: REPEAT_ON_INTENT,
      spotify_repeat_off: REPEAT_OFF_INTENT,
      spotify_save_track: ADD_TO_COLLECTION_INTENT,
      spotify_play: PLAY_INTENT,
      spotify_pause: STOP_INTENT,
      spotify_next: NEXT_INTENT,
      spotify_previous: PREVIOUS_INTENT,
    };
    const intent = intentMap[tool];
    if (intent) {
      this.state.intent = intent;
      this.state.showingVoiceConfirmation = true;
      this.state.aiResponse = "";
    }
    this._clearAITimeout();

    if (TERMINAL_TOOLS.has(tool)) {
      this._terminalAutoCloseActive = true;
      this._scheduleClose(TERMINAL_CONFIRMATION_CLOSE_MS);
    }
  });

  _onMicLevel = action((data) => {
    this.micLevelMovingAverage = data.level || 0;
  });

  retry = action(() => {
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
    this._terminalAutoCloseActive = false;
    this._clearCaptureTimeout();
    this._clearAITimeout();
    this._clearCloseTimeout();
    this._stopSyntheticMicLevel();
    this.micLevelMovingAverage = 0;
  });

  _startCaptureTimeout() {
    this._clearCaptureTimeout();
    this._captureTimeoutId = setTimeout(
      action(() => {
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
    this._stopSyntheticMicLevel();
  }
}

export default VoiceStore;
