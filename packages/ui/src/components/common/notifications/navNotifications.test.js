import { describe, expect, test } from "bun:test";
import {
  createNavNotificationController,
  normalizeNavUpdate,
} from "./navNotifications";
import { maneuverDirection, maneuverGlyph } from "./maneuverGlyphs";

describe("normalizeNavUpdate", () => {
  test("parses the Android nav payload", () => {
    const nav = normalizeNavUpdate({
      instruction: "Turn left onto Finch Crescent",
      distance: "190 m",
      eta: "Arrive 5:16 PM",
    });
    expect(nav).toEqual({
      instruction: "Turn left onto Norcap Crescent",
      distance: "190 m",
      eta: "Arrive 5:16 PM",
    });
  });

  test("defaults an empty distance and keeps a null eta", () => {
    const nav = normalizeNavUpdate({ instruction: "Continue straight" });
    expect(nav).toEqual({
      instruction: "Continue straight",
      distance: "",
      eta: null,
    });
  });

  test("returns null without an instruction", () => {
    expect(normalizeNavUpdate({ distance: "100 m" })).toBeNull();
    expect(normalizeNavUpdate(null)).toBeNull();
    expect(normalizeNavUpdate({ instruction: "   " })).toBeNull();
  });
});

const harness = () => {
  const added = [];
  const removed = [];
  const timers = [];
  let seq = 0;
  const controller = createNavNotificationController({
    addNotification: (notification) => {
      const id = `n${(seq += 1)}`;
      added.push({ id, notification });
      return id;
    },
    removeNotification: (id) => removed.push(id),
    schedule: (callback) => {
      const timer = { callback, cancelled: false };
      timers.push(timer);
      return timer;
    },
    cancel: (timer) => {
      timer.cancelled = true;
    },
    durationMs: 8000,
  });
  const fireLastTimer = () => {
    const timer = timers[timers.length - 1];
    if (timer && !timer.cancelled) timer.callback();
  };
  return { controller, added, removed, timers, fireLastTimer };
};

const turn = (instruction, distance) => ({
  instruction,
  distance,
  eta: "Arrive 6:36 PM",
});

describe("createNavNotificationController", () => {
  test("posts a banner on the first turn with the maneuver glyph as its icon", () => {
    const { controller, added } = harness();
    controller.update(turn("Turn left onto Main St", "300 m"));

    expect(added).toHaveLength(1);
    expect(added[0].notification.title).toBe("Turn left onto Main St");
    expect(added[0].notification.icon).toBe(
      maneuverGlyph("Turn left onto Main St"),
    );
    expect(added[0].notification.description).toBe("300 m  ·  Arrive 6:36 PM");
    expect(added[0].notification.appName).toBeUndefined();
  });

  test("ignores distance ticks for the same maneuver", () => {
    const { controller, added, removed } = harness();
    controller.update(turn("Turn left onto Main St", "300 m"));
    controller.update(turn("Turn left onto Main St", "250 m"));
    controller.update(turn("Turn left onto Main St", "80 m"));

    expect(added).toHaveLength(1);
    expect(removed).toHaveLength(0);
  });

  test("replaces the banner when a new turn arrives", () => {
    const { controller, added, removed } = harness();
    controller.update(turn("Turn left onto Main St", "300 m"));
    controller.update(turn("Turn right onto Oak Ave", "120 m"));

    expect(added).toHaveLength(2);
    expect(added[1].notification.title).toBe("Turn right onto Oak Ave");
    expect(removed).toEqual(["n1"]);
  });

  test("auto-dismisses on the notification timer", () => {
    const { controller, removed, fireLastTimer } = harness();
    controller.update(turn("Turn left onto Main St", "300 m"));
    fireLastTimer();
    expect(removed).toEqual(["n1"]);
  });

  test("stays hidden for the same maneuver after auto-dismiss", () => {
    const { controller, added, fireLastTimer } = harness();
    controller.update(turn("Turn left onto Main St", "300 m"));
    fireLastTimer();
    controller.update(turn("Turn left onto Main St", "60 m"));
    expect(added).toHaveLength(1);
  });

  test("uses the direction-specific glyph for each maneuver", () => {
    const { controller, added } = harness();
    controller.update(turn("Turn right onto Oak Ave", "50 m"));
    expect(added[0].notification.icon).toBe(
      maneuverGlyph("Turn right onto Oak Ave"),
    );
  });

  test("clear() dismisses the banner and lets the same maneuver re-show", () => {
    const { controller, added, removed } = harness();
    controller.update(turn("Turn left onto Main St", "300 m"));
    controller.clear();
    expect(removed).toEqual(["n1"]);

    controller.update(turn("Turn left onto Main St", "300 m"));
    expect(added).toHaveLength(2);
  });
});

describe("maneuverDirection", () => {
  test("classifies Maps instructions by turn direction", () => {
    expect(maneuverDirection("Turn left onto Main St")).toBe("left");
    expect(maneuverDirection("Slight right")).toBe("right");
    expect(maneuverDirection("Keep left")).toBe("left");
    expect(maneuverDirection("Continue straight")).toBe("straight");
    expect(maneuverDirection("Head toward 5th Ave")).toBe("straight");
    expect(maneuverDirection("Make a U-turn")).toBe("uturn");
  });
});
