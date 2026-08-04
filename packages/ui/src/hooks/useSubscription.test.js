import { describe, expect, test } from "bun:test";
import { hasStrictNocturnePlusAccess } from "./useSubscription";

describe("strict Nocturne+ entitlement", () => {
  test.each(["active", "past_due", "trialing"])(
    "allows subscribed users with %s status",
    (status) => {
      expect(
        hasStrictNocturnePlusAccess({
          subscribed: true,
          status,
          entitlementsVerified: true,
        }),
      ).toBe(true);
    },
  );

  test("normalizes status casing and surrounding whitespace", () => {
    expect(
      hasStrictNocturnePlusAccess({
        subscribed: true,
        status: "  PAST_DUE  ",
        entitlementsVerified: true,
      }),
    ).toBe(true);
  });

  test.each([null, undefined, "", "none", "canceled", "expired"])(
    "fails closed for status %p",
    (status) => {
      expect(
        hasStrictNocturnePlusAccess({
          subscribed: true,
          status,
          entitlementsVerified: true,
        }),
      ).toBe(false);
    },
  );

  test("rejects an allowed status when subscribed is not strictly true", () => {
    for (const subscribed of [false, null, undefined, 1, "true"]) {
      expect(
        hasStrictNocturnePlusAccess({
          subscribed,
          status: "active",
          entitlementsVerified: true,
        }),
      ).toBe(false);
    }
  });

  test("allows a verified admin without an active subscription status", () => {
    expect(
      hasStrictNocturnePlusAccess({
        subscribed: false,
        status: "none",
        isAdmin: true,
        entitlementsVerified: true,
      }),
    ).toBe(true);
  });

  test("rejects an admin claim unless verification is strictly true", () => {
    for (const entitlementsVerified of [false, null, undefined, 1, "true"]) {
      expect(
        hasStrictNocturnePlusAccess({
          subscribed: true,
          status: "active",
          isAdmin: true,
          entitlementsVerified,
        }),
      ).toBe(false);
    }
  });

  test("rejects an unverified active subscription", () => {
    expect(
      hasStrictNocturnePlusAccess({
        subscribed: true,
        status: "active",
        entitlementsVerified: false,
      }),
    ).toBe(false);
  });

  test("does not grant Nocturne+ access to lifetime-only users", () => {
    expect(
      hasStrictNocturnePlusAccess({
        subscribed: false,
        status: "none",
        hasLifetime: true,
        isAdmin: false,
        entitlementsVerified: true,
      }),
    ).toBe(false);
  });

  test("does not grant pre-auth compatibility access", () => {
    expect(
      hasStrictNocturnePlusAccess({
        subscribed: true,
        status: "none",
        hasLifetime: true,
        isAdmin: false,
        entitlementsVerified: false,
      }),
    ).toBe(false);
  });
});
