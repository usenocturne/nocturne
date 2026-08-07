import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import VoiceStore from "./VoiceStore";

beforeAll(() => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
  globalThis.WebSocket = class extends EventTarget {
    static OPEN = 1;
    readyState = 0;
    send() {}
    close() {}
  };
});

const stores = [];

const createStore = () => {
  const store = new VoiceStore(
    {
      viewStore: { appView: "MAIN", isOnboarding: false, isNpv: false },
      overlayController: { showVoice: () => {}, hideVoice: () => {} },
      shelfStore: { clearVoiceItems: () => {}, voiceItems: [] },
      onboardingStore: { setWakewordTriggered: () => {} },
    },
    null,
    null,
  );
  stores.push(store);
  return store;
};

afterEach(() => {
  while (stores.length) {
    stores.pop().dispose();
  }
});

describe("Mockingbird voice capture liveness", () => {
  test("mic level frames rearm the capture timeout while listening", () => {
    const store = createStore();
    store.onWakeWord();
    const initialTimer = store._captureTimeoutId;
    expect(initialTimer).not.toBeNull();

    store._onMicLevel({ level: 0.4 });
    expect(store.micLevelMovingAverage).toBe(0.4);
    expect(store._captureTimeoutId).not.toBeNull();
    expect(store._captureTimeoutId).not.toBe(initialTimer);
  });

  test("mic level frames never arm a capture timeout on their own", () => {
    const store = createStore();
    expect(store._captureTimeoutId).toBeNull();
    store._onMicLevel({ level: 0.2 });
    expect(store._captureTimeoutId).toBeNull();
  });
});

describe("Mockingbird voice session binding from ai.state", () => {
  test("pre-transcript thinking binds the session and swaps capture for AI timeout", () => {
    const store = createStore();
    store.onWakeWord();
    store.onAIState({ state: "thinking", session_id: "session-a" });

    expect(store.currentSessionId).toBe("session-a");
    expect(store.state.aiState).toBe("thinking");
    expect(store._captureTimeoutId).toBeNull();
    expect(store._aiTimeoutId).not.toBeNull();

    store._onMicLevel({ level: 0.1 });
    expect(store._captureTimeoutId).toBeNull();
  });

  test("ai.state from a rejected session neither binds nor mutates the turn", () => {
    const store = createStore();
    store.onWakeWord();
    store.onAIState({ state: "thinking", session_id: "session-a" });

    store.onWakeWord();
    expect(store.currentSessionId).toBeNull();

    store.onAIState({ state: "thinking", session_id: "session-a" });
    expect(store.currentSessionId).toBeNull();
    expect(store.state.aiState).toBe("idle");
  });

  test("final transcription hands off to the AI timeout and mic frames stop rearming", () => {
    const store = createStore();
    store.onWakeWord();
    store.onTranscription({
      transcript: "play jazz",
      is_final: true,
      session_id: "session-b",
    });

    expect(store.currentSessionId).toBe("session-b");
    expect(store._captureTimeoutId).toBeNull();
    expect(store._aiTimeoutId).not.toBeNull();

    store._onMicLevel({ level: 0.3 });
    expect(store._captureTimeoutId).toBeNull();
  });
});
