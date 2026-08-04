import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import IncomingCallOverlay, {
  INCOMING_CALL_GRADIENT,
} from "./IncomingCallOverlay";

const call = (overrides = {}) => ({
  callId: "call-1",
  device: "AA:BB:CC:DD:EE:FF",
  remoteId: "+15555550100",
  displayName: "Test Caller",
  status: "ringing",
  direction: "incoming",
  label: "mobile",
  service: "telephony",
  ...overrides,
});

const render = (props = {}) =>
  renderToStaticMarkup(
    createElement(IncomingCallOverlay, {
      call: call(),
      pendingAction: null,
      error: null,
      onAccept: () => {},
      onDecline: () => {},
      ...props,
    }),
  );

describe("IncomingCallOverlay", () => {
  test("renders the caller identity, Lucide placeholder, and circular actions", () => {
    const markup = render();

    expect(markup).toContain("Test Caller");
    expect(markup).toContain("+15555550100");
    expect(markup).toContain("h-[92px] w-[92px] text-white/55");
    expect(markup).toContain('d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2"');
    expect(markup).not.toContain("caller-placeholder.jpg");
    expect(markup.indexOf("<h1")).toBeLessThan(
      markup.indexOf('d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2"'),
    );
    expect(markup).toContain('aria-label="Accept call from Test Caller"');
    expect(markup).toContain('aria-label="Decline call from Test Caller"');
    expect(markup).not.toContain(">Accept<");
    expect(markup).not.toContain(">Decline<");
    expect(markup).not.toContain("mobile");
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup.match(/h-\[120px\]/g)).toHaveLength(2);
    expect(markup.match(/w-\[120px\]/g)).toHaveLength(2);
    expect(markup.match(/h-\[52px\] w-\[52px\]/g)).toHaveLength(2);
    expect(markup).toContain("justify-center gap-[96px]");
    expect(markup.match(/rounded-full/g)).toHaveLength(3);
    expect(markup.match(/fill="currentColor"/g)).toHaveLength(2);
  });

  test("uses the Nocturne system-screen mesh gradient", () => {
    const markup = render();

    expect(INCOMING_CALL_GRADIENT).toContain("#3B518B");
    expect(INCOMING_CALL_GRADIENT).toContain("#151231");
    expect(markup).toContain("radial-gradient(at 0% 25%");
  });

  test("does not show an incoming-call label or activity indicator", () => {
    const markup = render();

    expect(markup).not.toContain(">Incoming call<");
    expect(markup).not.toContain("animate-ping");
  });

  test("places the caller glyph after the left-aligned identity", () => {
    const markup = render();

    expect(markup).toContain(
      "mt-[68px] flex w-full min-w-0 items-center gap-10",
    );
    expect(markup).toContain("min-w-0 flex-1 text-left");
    expect(markup).toContain("text-[60px]");
    expect(markup).toContain("min-w-0 text-left text-[30px]");
    expect(markup).not.toContain('viewBox="0 0 457 452"');
  });

  test("uses safe fallbacks when iOS withholds caller identity", () => {
    const markup = render({
      call: call({ displayName: "", remoteId: "" }),
    });

    expect(markup).toContain("Unknown caller");
    expect(markup).toContain("No caller ID");
  });

  test("keeps FaceTime context accessible and disables both actions while answering", () => {
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
    expect(markup).not.toContain("Answering...");
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });

  test("renders nothing without a ringing call", () => {
    expect(render({ call: null })).toBe("");
  });
});
