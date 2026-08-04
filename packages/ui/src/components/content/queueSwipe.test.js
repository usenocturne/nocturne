import { describe, expect, test } from "bun:test";
import {
  getQueueSwipePresentation,
  getQueueSwipeVisualOffset,
  hasQueueSwipeMoved,
  measureQueueSwipe,
  QUEUE_SWIPE_MAX_OFFSET,
  requestQueueAdd,
  shouldCommitQueueSwipe,
} from "./queueSwipe";

describe("ContentView queue swipe", () => {
  test("waits for deliberate movement before choosing an axis", () => {
    expect(
      measureQueueSwipe({
        startX: 100,
        startY: 100,
        currentX: 94,
        currentY: 103,
      }),
    ).toEqual({ axis: null, rawOffset: 0, offset: 0 });
  });

  test("distinguishes tap jitter from meaningful ambiguous movement", () => {
    expect(
      hasQueueSwipeMoved({
        startX: 100,
        startY: 100,
        currentX: 94,
        currentY: 103,
      }),
    ).toBe(false);
    expect(
      hasQueueSwipeMoved({
        startX: 100,
        startY: 100,
        currentX: 70,
        currentY: 70,
      }),
    ).toBe(true);
  });

  test("reveals the queue action only for a left swipe", () => {
    expect(
      measureQueueSwipe({
        startX: 100,
        startY: 100,
        currentX: 55,
        currentY: 104,
      }),
    ).toEqual({ axis: "horizontal", rawOffset: -45, offset: -45 });

    expect(
      measureQueueSwipe({
        startX: 100,
        startY: 100,
        currentX: 145,
        currentY: 104,
      }),
    ).toEqual({ axis: "horizontal", rawOffset: 0, offset: 0 });
  });

  test("keeps vertical scrolling out of the queue gesture", () => {
    expect(
      measureQueueSwipe({
        startX: 100,
        startY: 100,
        currentX: 88,
        currentY: 55,
      }),
    ).toEqual({ axis: "vertical", rawOffset: 0, offset: 0 });

    expect(
      measureQueueSwipe({
        startX: 100,
        startY: 100,
        currentX: 86,
        currentY: 88,
      }),
    ).toEqual({ axis: null, rawOffset: 0, offset: 0 });
  });

  test("adds restrained resistance after the commit threshold", () => {
    expect(getQueueSwipeVisualOffset(-63)).toBe(-63);
    expect(getQueueSwipeVisualOffset(-64)).toBe(-64);
    expect(getQueueSwipeVisualOffset(-84)).toBe(-74);
    expect(getQueueSwipeVisualOffset(-300)).toBe(-QUEUE_SWIPE_MAX_OFFSET);
    expect(getQueueSwipeVisualOffset(40)).toBe(0);
  });

  test("commits only after the threshold", () => {
    expect(shouldCommitQueueSwipe(-63)).toBe(false);
    expect(shouldCommitQueueSwipe(-64)).toBe(true);
  });

  test("maps drag progress to a bounded action presentation", () => {
    expect(getQueueSwipePresentation(0)).toEqual({
      reveal: 0,
      progress: 0,
      panelOpacity: 0,
      iconScale: 0.76,
      iconTranslateX: 12,
      iconRotation: -6,
    });

    const fullReveal = getQueueSwipePresentation(-200);
    expect(fullReveal).toEqual({
      reveal: QUEUE_SWIPE_MAX_OFFSET,
      progress: 1,
      panelOpacity: 1,
      iconScale: 1,
      iconTranslateX: 0,
      iconRotation: -0,
    });
  });

  test("does not change direction after the gesture locks", () => {
    expect(
      measureQueueSwipe({
        startX: 100,
        startY: 100,
        currentX: 70,
        currentY: 20,
        lockedAxis: "horizontal",
      }),
    ).toEqual({ axis: "horizontal", rawOffset: -30, offset: -30 });
  });

  test("keeps the raw commit distance separate from resisted visuals", () => {
    const measurement = measureQueueSwipe({
      startX: 100,
      startY: 100,
      currentX: 20,
      currentY: 100,
    });

    expect(measurement.rawOffset).toBe(-80);
    expect(measurement.offset).toBe(-72);
    expect(shouldCommitQueueSwipe(measurement.rawOffset)).toBe(true);
  });

  test("does not commit after crossing the threshold and reversing", () => {
    const measurement = measureQueueSwipe({
      startX: 100,
      startY: 100,
      currentX: 60,
      currentY: 105,
      lockedAxis: "horizontal",
    });

    expect(measurement).toEqual({
      axis: "horizontal",
      rawOffset: -40,
      offset: -40,
    });
    expect(shouldCommitQueueSwipe(measurement.rawOffset)).toBe(false);
  });

  test("sends the exact queue request and returns its acknowledgement", async () => {
    const calls = [];
    const abortController = new AbortController();
    let acknowledge;
    const acknowledgement = new Promise((resolve) => {
      acknowledge = resolve;
    });
    const sendSpotifyCommand = (...args) => {
      calls.push(args);
      return acknowledgement;
    };

    const request = requestQueueAdd(
      sendSpotifyCommand,
      "spotify:track:queued",
      abortController.signal,
    );

    expect(calls).toEqual([
      [
        "spotify.player.queue.add",
        { uri: "spotify:track:queued" },
        abortController.signal,
      ],
    ]);
    expect(request).toBe(acknowledgement);

    acknowledge({});
    await expect(request).resolves.toEqual({});
  });
});
