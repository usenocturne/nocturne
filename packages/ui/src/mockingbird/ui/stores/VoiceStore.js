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
} from "../components/Listening/VoiceConfirmationIntents";

const RESPONSE_TIMEOUT = 15000;
const TIMEOUT_BEFORE_CLOSING_LISTENING_MS = 7500;
const OVERLAY_TRANSITION_DURATION_MS = 300;

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
  microphoneLevelsSlidingWindow = [];
  _wsCleanup = null;
  _responseTimeoutId = null;
  _closeTimeoutId = null;
  _micLevelIntervalId = null;

  constructor(rootStore, socket, middlewareActions) {
    this.rootStore = rootStore;
    makeAutoObservable(this, {
      rootStore: false,
      _wsCleanup: false,
      _responseTimeoutId: false,
      _closeTimeoutId: false,
      _micLevelIntervalId: false,
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
    this.resetVoiceSessionState();
    overlayController.showVoice();
    this._startResponseTimeout();
    this._startSyntheticMicLevel();
  });

  onTranscription = action((data) => {
    this.state.asr.transcript = data.transcript || "";
    this.state.asr.isFinal = !!data.is_final;
    if (data.is_final) {
      this._stopSyntheticMicLevel();
    }
  });

  onAIState = action((data) => {
    const prevState = this.state.aiState;
    this.state.aiState = data.state || "idle";
    if (data.state === "idle" && prevState === "speaking") {
      this._scheduleClose();
    }
  });

  onAIResponse = action((data) => {
    this.state.aiResponse = data.text || "";
    this._clearResponseTimeout();
    this._stopSyntheticMicLevel();
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
    };
    const intent = intentMap[tool];
    if (intent) {
      this.state.intent = intent;
      this.state.showingVoiceConfirmation = true;
      this.state.aiResponse = "";
    }
  });

  retry = action(() => {
    this.state.error = null;
    this.state.friendlyError = "";
    this.state.asr.transcript = "";
    this.state.asr.isFinal = false;
    this._clearResponseTimeout();
    this._clearCloseTimeout();
    this._startResponseTimeout();
    this._startSyntheticMicLevel();
    sendNocturneWsRequest("audio.record.start", {});
  });

  cancel = action(() => {
    sendNocturneWsRequest("audio.record.stop", {});
    this.rootStore.overlayController.hideVoice();
    this._clearResponseTimeout();
    this._clearCloseTimeout();
    this._stopSyntheticMicLevel();
    setTimeout(
      action(() => {
        this.resetVoiceSessionState();
      }),
      OVERLAY_TRANSITION_DURATION_MS,
    );
  });

  resetVoiceSessionState = action(() => {
    this.state = getInitialVoiceSessionState();
    this._clearResponseTimeout();
    this._clearCloseTimeout();
    this._stopSyntheticMicLevel();
    this.micLevelMovingAverage = 0;
  });

  _startResponseTimeout() {
    this._clearResponseTimeout();
    this._responseTimeoutId = setTimeout(
      action(() => {
        this.state.error = "error";
        this.state.friendlyError = "Something went wrong. Tap to try again.";
        this._stopSyntheticMicLevel();
        this._scheduleClose();
      }),
      RESPONSE_TIMEOUT,
    );
  }

  _clearResponseTimeout() {
    if (this._responseTimeoutId) {
      clearTimeout(this._responseTimeoutId);
      this._responseTimeoutId = null;
    }
  }

  _scheduleClose() {
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
      TIMEOUT_BEFORE_CLOSING_LISTENING_MS,
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
    this._clearResponseTimeout();
    this._clearCloseTimeout();
    this._stopSyntheticMicLevel();
  }
}

export default VoiceStore;
