import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MockingbirdIncomingCallOverlay from "./MockingbirdIncomingCallOverlay";

const call = (overrides = {}) => ({
  callId: "call-1",
  device: "AA:BB:CC:DD:EE:FF",
  remoteId: "+15555550100",
  displayName: "Test Caller",
  status: "ringing",
  direction: "incoming",
  service: "telephony",
  ...overrides,
});

const render = (props = {}) =>
  renderToStaticMarkup(
    createElement(MockingbirdIncomingCallOverlay, {
      call: call(),
      pendingAction: null,
      error: null,
      onAccept: () => {},
      onDecline: () => {},
      ...props,
    }),
  );

describe("MockingbirdIncomingCallOverlay", () => {
  test("renders the upstream caller layout and accessible actions", () => {
    const markup = render();

    expect(markup).toContain("Test Caller");
    expect(markup).toContain("+15555550100");
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-label="Accept call from Test Caller"');
    expect(markup).toContain('aria-label="Decline call from Test Caller"');
    expect(markup).toContain('viewBox="0 0 64 64"');
    expect(markup).toContain('fill="#1ED760"');
    expect(markup).toContain('viewBox="0 0 78 32"');
    expect(markup).toContain('fill="#E22134"');
    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).not.toContain(">Accept<");
    expect(markup).not.toContain(">Decline<");
  });

  test("uses the number and incoming-call fallback without duplicating identity", () => {
    const markup = render({ call: call({ displayName: "" }) });

    expect(markup).toContain("+15555550100");
    expect(markup).toContain(">Incoming call<");
  });

  test("uses a safe fallback when iOS withholds all caller identity", () => {
    const markup = render({
      call: call({ displayName: "", remoteId: "" }),
    });

    expect(markup).toContain("Number unavailable");
    expect(markup).toContain(">Incoming call<");
  });

  test("keeps FaceTime context accessible and disables both pending actions", () => {
    const markup = render({
      call: call({ service: "facetime_audio" }),
      pendingAction: {
        callKey: "AA:BB:CC:DD:EE:FF:call-1",
        action: "accept",
      },
    });

    expect(markup).toContain(
      'aria-label="Incoming FaceTime audio from Test Caller"',
    );
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });

  test("surfaces action errors and renders nothing without a call", () => {
    expect(render({ error: "Could not answer this call" })).toContain(
      "Could not answer this call",
    );
    expect(render({ call: null })).toBe("");
  });
});
