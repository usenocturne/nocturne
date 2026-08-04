import { describe, expect, test } from "bun:test";
import {
  beginPhoneCallAction,
  isCurrentPhoneCallAction,
  normalizePhoneCall,
  phoneCallKey,
  phoneCallReducer,
  selectIncomingCall,
  selectPresentedPhoneCall,
  shouldRefreshPhoneCallSnapshot,
} from "./usePhoneCalls";

const incomingCall = (overrides = {}) => ({
  callId: "call-1",
  device: "AA:BB:CC:DD:EE:FF",
  remoteId: "+15555550100",
  displayName: "Test Caller",
  status: "ringing",
  direction: "incoming",
  service: "telephony",
  ...overrides,
});

describe("phone call normalization", () => {
  test("normalizes native snake-case call snapshots", () => {
    expect(
      normalizePhoneCall({
        call_id: "call-1",
        device: "AA:BB:CC:DD:EE:FF",
        remote_id: "+15555550100",
        display_name: "Test Caller",
        status: "ringing",
        direction: "incoming",
        started_at_unix_s: 1777777777,
      }),
    ).toEqual({
      callId: "call-1",
      device: "AA:BB:CC:DD:EE:FF",
      remoteId: "+15555550100",
      displayName: "Test Caller",
      status: "ringing",
      direction: "incoming",
      startedAtUnixS: 1777777777,
    });
  });

  test("accepts generated camel-case call snapshots", () => {
    expect(normalizePhoneCall(incomingCall())).toEqual(incomingCall());
  });

  test("rejects snapshots without routing or lifecycle identity", () => {
    expect(normalizePhoneCall({ status: "ringing" })).toBeNull();
    expect(
      normalizePhoneCall({
        call_id: "call-1",
        status: "ringing",
        direction: "incoming",
      }),
    ).toBeNull();
  });
});

describe("phone call lifecycle", () => {
  test("refreshes snapshots when a phone companion becomes ready", () => {
    expect(
      shouldRefreshPhoneCallSnapshot({
        type: "event",
        topic: "app.ready",
        data: { platform: "android" },
      }),
    ).toBe(true);
    expect(
      shouldRefreshPhoneCallSnapshot({
        type: "event",
        topic: "app.ready",
        data: { platform: "ios" },
      }),
    ).toBe(true);
    expect(
      shouldRefreshPhoneCallSnapshot({
        type: "event",
        topic: "app.ready",
        data: { platform: "web" },
      }),
    ).toBe(false);
    expect(
      shouldRefreshPhoneCallSnapshot({
        type: "event",
        topic: "phone.call.started",
        data: incomingCall(),
      }),
    ).toBe(false);
  });

  test("keeps lifecycle state while presentation is disabled", () => {
    const call = incomingCall();

    expect(selectPresentedPhoneCall(call, false)).toBeNull();
    expect(selectPresentedPhoneCall(call, true)).toBe(call);
  });

  test("hydrates a ringing call from a snapshot replacement", () => {
    const state = phoneCallReducer(
      { calls: {}, order: [] },
      { type: "replace", calls: [incomingCall()] },
    );

    expect(selectIncomingCall(state)).toEqual(incomingCall());
  });

  test("keeps the newest ringing incoming call and ignores outgoing calls", () => {
    let state = { calls: {}, order: [] };
    state = phoneCallReducer(state, {
      type: "upsert",
      call: incomingCall({ callId: "outgoing", direction: "outgoing" }),
    });
    state = phoneCallReducer(state, {
      type: "upsert",
      call: incomingCall({ callId: "first", displayName: "First" }),
    });
    state = phoneCallReducer(state, {
      type: "upsert",
      call: incomingCall({ callId: "second", displayName: "Second" }),
    });

    expect(selectIncomingCall(state)?.displayName).toBe("Second");
  });

  test("removes a disconnected call without disturbing another call", () => {
    const first = incomingCall({ callId: "first" });
    const second = incomingCall({ callId: "second" });
    let state = phoneCallReducer(
      { calls: {}, order: [] },
      { type: "replace", calls: [first, second] },
    );

    state = phoneCallReducer(state, {
      type: "remove",
      callId: "second",
      device: second.device,
    });

    expect(selectIncomingCall(state)).toEqual(first);
    expect(state.calls[phoneCallKey(second)]).toBeUndefined();
  });

  test("blocks a second action while the first action is pending", () => {
    const call = incomingCall();
    const pending = beginPhoneCallAction(null, call, "accept");

    expect(pending).toEqual({ callKey: phoneCallKey(call), action: "accept" });
    expect(beginPhoneCallAction(pending, call, "decline")).toBeNull();
  });

  test("does not let a stale request settle a newer call action", () => {
    const call = incomingCall();
    const stale = beginPhoneCallAction(null, call, "accept");
    const current = beginPhoneCallAction(null, call, "decline");

    expect(stale).not.toBeNull();
    expect(current).not.toBeNull();
    expect(isCurrentPhoneCallAction(current, stale)).toBe(false);
    expect(isCurrentPhoneCallAction(current, current)).toBe(true);
  });
});
