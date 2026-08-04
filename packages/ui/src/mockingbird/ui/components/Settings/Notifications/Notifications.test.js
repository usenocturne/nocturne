import { beforeAll, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let Notifications;

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
  Notifications = (await import("./Notifications")).default;
});

describe("Mockingbird notification settings", () => {
  test("renders the functional onscreen notification toggle", () => {
    const markup = renderToStaticMarkup(createElement(Notifications));

    expect(markup).toContain("Notifications onscreen");
    expect(markup).toContain(">On<");
    expect(markup).toContain("Mirrored notifications from your phone");
    expect(markup).not.toContain("Coming in a future update");
  });
});
