import { beforeAll, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let PhoneCalls;

beforeAll(async () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
  globalThis.window = new EventTarget();
  window.setTimeout = setTimeout;
  window.clearTimeout = clearTimeout;
  globalThis.WebSocket = class extends EventTarget {
    static OPEN = 1;
    readyState = 0;
    send() {}
    close() {}
  };
  PhoneCalls = (await import("./PhoneCalls")).default;
});

describe("Mockingbird phone call settings", () => {
  test("shows the active incoming-call capability without future copy", () => {
    const markup = renderToStaticMarkup(createElement(PhoneCalls));

    expect(markup).toContain("Phone calls onscreen");
    expect(markup).toContain(">On<");
    expect(markup).toContain("incoming phone call information");
    expect(markup).not.toContain("Coming in a future update");
    expect(markup).not.toContain("incoming and outgoing");
  });
});
