import { beforeAll, describe, expect, test } from "bun:test";
import { voiceReducer, getInitialState } from "./VoiceContext";

beforeAll(() => {
  const values = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  } as Storage;
  globalThis.WebSocket = class extends EventTarget {
    static OPEN = 1;
    readyState = 0;
    send() {}
    close() {}
  } as unknown as typeof WebSocket;
});

describe("voiceReducer session binding from ai.state", () => {
  test("pre-transcript thinking binds the session on an open turn", () => {
    let state = getInitialState();
    state = voiceReducer(state, { type: "WAKEWORD_DETECTED" });
    state = voiceReducer(state, {
      type: "AI_STATE_CHANGE",
      payload: { state: "thinking", session_id: "s-1" },
    });

    expect(state.phase).toBe("thinking");
    expect(state.currentSessionId).toBe("s-1");
  });

  test("a rejected session does not re-bind", () => {
    let state = getInitialState();
    state = voiceReducer(state, { type: "WAKEWORD_DETECTED" });
    state = voiceReducer(state, { type: "REJECT_SESSION", payload: "s-old" });
    state = voiceReducer(state, {
      type: "AI_STATE_CHANGE",
      payload: { state: "thinking", session_id: "s-old" },
    });

    expect(state.currentSessionId).toBeNull();
  });

  test("ai.state does not bind a session while the overlay is closed", () => {
    let state = getInitialState();
    state = voiceReducer(state, {
      type: "AI_STATE_CHANGE",
      payload: { state: "thinking", session_id: "s-2" },
    });

    expect(state.currentSessionId).toBeNull();
  });

  test("an already-bound session is not replaced by a different id", () => {
    let state = getInitialState();
    state = voiceReducer(state, { type: "WAKEWORD_DETECTED" });
    state = voiceReducer(state, {
      type: "AI_STATE_CHANGE",
      payload: { state: "thinking", session_id: "s-1" },
    });
    state = voiceReducer(state, {
      type: "AI_STATE_CHANGE",
      payload: { state: "executing_tool", session_id: "s-2" },
    });

    expect(state.currentSessionId).toBe("s-1");
  });

  test("the final transcript after a pre-transcript thinking keeps the turn intact", () => {
    let state = getInitialState();
    state = voiceReducer(state, { type: "WAKEWORD_DETECTED" });
    state = voiceReducer(state, {
      type: "AI_STATE_CHANGE",
      payload: { state: "thinking", session_id: "s-1" },
    });
    state = voiceReducer(state, {
      type: "TRANSCRIPT_UPDATE",
      payload: { transcript: "play jazz", is_final: true, session_id: "s-1" },
    });

    expect(state.phase).toBe("thinking");
    expect(state.transcript).toBe("play jazz");
    expect(state.isFinal).toBe(true);
    expect(state.currentSessionId).toBe("s-1");
  });
});
