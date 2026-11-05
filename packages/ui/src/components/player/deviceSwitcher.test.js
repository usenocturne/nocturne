import { describe, expect, test } from "bun:test";
import { shouldApplyDeviceResponse } from "./deviceSwitcher";

describe("device switcher responses", () => {
  test("keeps a slow first load when the quiet wake refetch never succeeds", () => {
    const cancelledThroughId = 1;
    const firstLoad = 2;
    expect(shouldApplyDeviceResponse(firstLoad, cancelledThroughId, 0)).toBe(
      true,
    );
  });

  test("drops an older load that finishes after a newer one applied", () => {
    expect(shouldApplyDeviceResponse(2, 1, 3)).toBe(false);
  });

  test("drops loads issued before the modal was closed or refreshed", () => {
    expect(shouldApplyDeviceResponse(2, 4, 0)).toBe(false);
  });
});
