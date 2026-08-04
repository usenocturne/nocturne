import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createNotificationBridgeController,
  createOtaUpdateNotificationController,
  normalizeNotificationRemove,
  normalizeNotificationShow,
  otaUpdateNotificationKey,
} from "./NotificationBridge";
import NotificationBanner from "./NotificationBanner";
import {
  hasMultipleNotificationDescriptionLines,
  notificationDescriptionClassName,
  shouldEmphasizeNotificationFirstLine,
  visibleNotificationsForExpandedId,
} from "./notificationLayout";
import {
  NOTIFICATION_APP_ICON_CATALOG,
  SettingsUpdateIcon,
  SmartphoneIcon,
  notificationIconSrcForBundleId,
} from "../icons";

const event = (topic, data) => ({ type: "event", topic, data });

const createHarness = (options = {}) => {
  const added = [];
  const removed = [];
  const timers = new Map();
  const cancelledTimers = [];
  let nextInternalId = 1;
  let nextTimerId = 1;
  const controller = createNotificationBridgeController({
    addNotification: (notification) => {
      added.push(notification);
      return `internal-${nextInternalId++}`;
    },
    removeNotification: (id) => removed.push(id),
    createId: () => "generated-id",
    schedule: (callback, delayMs) => {
      const id = nextTimerId++;
      timers.set(id, { callback, delayMs });
      return id;
    },
    cancel: (id) => {
      cancelledTimers.push(id);
      timers.delete(id);
    },
    ...options,
  });
  return { added, removed, timers, cancelledTimers, controller };
};

const availableUpdate = {
  version: "4.2.0+20260728010000",
  kind: "image",
  channel: "stable",
  requiresReflash: false,
};

const otaNoticeSnapshot = (overrides = {}) => ({
  autoUpdateEnabled: false,
  available: availableUpdate,
  isActive: false,
  isComplete: false,
  isInstallPending: false,
  isChecking: false,
  lastCheckResult: "available",
  ...overrides,
});

const createOtaNoticeHarness = () => {
  const added = [];
  const removed = [];
  let nextInternalId = 1;
  const controller = createOtaUpdateNotificationController({
    addNotification: (notification) => {
      added.push(notification);
      return `ota-internal-${nextInternalId++}`;
    },
    removeNotification: (id) => removed.push(id),
  });
  return { added, removed, controller };
};

describe("normalizeNotificationShow", () => {
  test("normalizes a canonical ANCS notification", () => {
    expect(
      normalizeNotificationShow({
        id: "ancs:42",
        title: "Alex",
        subtitle: "Messages",
        body: "On my way",
        category: "ios.social",
        app_name: "Messages",
        app_bundle_id: "com.apple.MobileSMS",
        silent: false,
        pre_existing: false,
      }),
    ).toEqual({
      id: "ancs:42",
      title: "Alex",
      description: "Messages\nOn my way",
      category: "ios.social",
      appName: "Messages",
      appBundleId: "com.apple.MobileSMS",
      isMirroredPhoneNotification: true,
      silent: false,
      preExisting: false,
    });
  });

  test("accepts generated camel-case aliases", () => {
    expect(
      normalizeNotificationShow({
        title: "Calendar",
        body: "Standup in 10 minutes",
        category: "ios.schedule",
        appBundleId: "com.apple.mobilecal",
        preExisting: true,
      }),
    ).toMatchObject({
      title: "Calendar",
      appName: null,
      appBundleId: "com.apple.mobilecal",
      isMirroredPhoneNotification: true,
      preExisting: true,
    });
  });

  test("uses the app name when a notification title is absent", () => {
    expect(
      normalizeNotificationShow({
        appName: "Mail",
        body: "New message",
        category: "ios.email",
      }),
    ).toMatchObject({ title: "Mail", appName: "Mail" });
  });

  test("does not duplicate identical subtitle and body text", () => {
    expect(
      normalizeNotificationShow({
        title: "Phone",
        subtitle: "Missed call",
        body: "Missed call",
      })?.description,
    ).toBe("Missed call");
  });

  test("rejects nonobjects and notifications without a title source", () => {
    expect(normalizeNotificationShow(null)).toBeNull();
    expect(normalizeNotificationShow("notification")).toBeNull();
    expect(normalizeNotificationShow({ body: "Missing title" })).toBeNull();
  });
});

describe("normalizeNotificationRemove", () => {
  test("returns only nonempty ids", () => {
    expect(normalizeNotificationRemove({ id: "ancs:42" })).toBe("ancs:42");
    expect(normalizeNotificationRemove({ id: " " })).toBeNull();
    expect(normalizeNotificationRemove(null)).toBeNull();
  });
});

describe("notification app icon catalog", () => {
  test("resolves every listed bundle id to validated local artwork", async () => {
    const manifest = JSON.parse(
      await Bun.file("public/images/notification-apps/manifest.json").text(),
    );
    const manifestBySrc = new Map(
      manifest.map((entry) => [
        `/images/notification-apps/${entry.file}`,
        entry,
      ]),
    );

    for (const entry of NOTIFICATION_APP_ICON_CATALOG) {
      for (const bundleId of entry.bundleIds) {
        expect(notificationIconSrcForBundleId(bundleId)).toBe(entry.src);
      }
      const manifestEntry = manifestBySrc.get(entry.src);
      expect(manifestEntry).toBeDefined();
      const asset = Bun.file(`public${entry.src}`);
      expect(await asset.exists()).toBe(true);
      const bytes = new Uint8Array(await asset.arrayBuffer());
      if (entry.src.endsWith(".png")) {
        expect(asset.type).toBe("image/png");
        expect([...bytes.slice(0, 8)]).toEqual([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]);
      } else {
        expect(asset.type).toBe("image/jpeg");
        expect(bytes[0]).toBe(0xff);
        expect(bytes[1]).toBe(0xd8);
        expect(bytes.at(-2)).toBe(0xff);
        expect(bytes.at(-1)).toBe(0xd9);
      }
      expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(
        manifestEntry.sha256,
      );
    }
  });

  test("matches bundle ids case-insensitively and leaves unknown apps unset", () => {
    expect(notificationIconSrcForBundleId("COM.APPLE.MOBILESMS")).toBe(
      notificationIconSrcForBundleId("com.apple.MobileSMS"),
    );
    expect(notificationIconSrcForBundleId("com.example.unknown")).toBeNull();
    expect(notificationIconSrcForBundleId(null)).toBeNull();
  });

  test("leaves intentionally excluded apps on the generic fallback", () => {
    for (const bundleId of [
      "com.google.chrome.ios",
      "doordash.DoorDashConsumer",
      "com.netflix.Netflix",
      "com.spotify.client",
      "com.ubercab.UberClient",
      "com.burbn.barcelona",
      "com.instagram.barcelona",
      "AlexisBarreyat.BeReal",
      "com.bereal.ft",
      "com.google.android.apps.photos",
      "com.google.android.apps.docs",
      "com.google.android.apps.walletnfcrel",
    ]) {
      expect(notificationIconSrcForBundleId(bundleId)).toBeNull();
    }
  });

  test("uses Android-specific artwork for Google apps", () => {
    for (const [packageId, iconSrc] of [
      [
        "com.google.android.apps.messaging",
        "/images/notification-apps/google-messages.png",
      ],
      [
        "com.google.android.dialer",
        "/images/notification-apps/google-phone.png",
      ],
      [
        "com.google.android.calendar",
        "/images/notification-apps/google-calendar.png",
      ],
      [
        "com.google.android.apps.chromecast.app",
        "/images/notification-apps/google-home.png",
      ],
      [
        "com.google.android.googlequicksearchbox",
        "/images/notification-apps/google.png",
      ],
    ]) {
      expect(notificationIconSrcForBundleId(packageId)).toBe(iconSrc);
    }
  });

  test("supports Find My notification identifiers", () => {
    for (const bundleId of [
      "com.apple.findmy",
      "com.apple.FindMySafetyAlertsNotifications",
      "com.apple.mobileme.fmip1",
      "com.apple.mobileme.fmf1",
    ]) {
      expect(notificationIconSrcForBundleId(bundleId)).toBe(
        "/images/notification-apps/find-my.jpg",
      );
    }
  });

  test("renders known app artwork in the notification banner", () => {
    const iconSrc = notificationIconSrcForBundleId("com.apple.MobileSMS");
    const markup = renderToStaticMarkup(
      createElement(NotificationBanner, {
        notification: {
          id: "notification-1",
          icon: SmartphoneIcon,
          iconSrc,
          appName: "Messages",
          title: "Alex",
          description: "On my way",
        },
        onDismiss: () => {},
      }),
    );
    expect(markup).toContain('src="/images/notification-apps/messages.jpg"');
    expect(markup).toContain("h-16 w-16 rounded-[16px] object-cover");
    expect(markup).toContain("notification-banner-enter");
    expect(markup).toContain("min-h-[120px]");
    expect(markup).toContain("max-h-[160px]");
    expect(markup).toContain("rounded-[24px]");
    expect(markup).toContain("bg-[#121218]");
    expect(markup).not.toContain("bg-[#121218]/95");
    expect(markup).toContain("gap-[18px]");
    expect(markup).toContain("truncate text-[25px] font-bold leading-[30px]");
    expect(markup).toContain("tracking-tight");
    expect(markup).not.toContain("tracking-[-0.025em]");
    expect(markup).not.toContain("space-x-3");
    expect(markup).toContain("whitespace-pre-wrap break-words line-clamp-2");
    expect(markup).not.toContain("opacity-80 truncate");
    expect(markup).not.toContain(">Messages<");
    expect(markup).toContain('aria-label="Dismiss notification"');
    expect(markup).toContain("h-[52px] w-[52px]");
    expect(markup.match(/<button/g)).toHaveLength(1);
    expect(markup).not.toContain("aria-expanded");
  });

  test("keeps app names for unregistered apps", () => {
    const markup = renderToStaticMarkup(
      createElement(NotificationBanner, {
        notification: {
          id: "notification-unknown",
          icon: SmartphoneIcon,
          appName: "Unknown App",
          title: "Alert",
          description: "One line",
        },
        onDismiss: () => {},
      }),
    );
    expect(markup).toContain(">Unknown App<");
  });

  test("keeps descriptions tight to notification titles", () => {
    const collapsedClassName = notificationDescriptionClassName(false);
    expect(collapsedClassName).toContain("-mt-px");
    expect(collapsedClassName).not.toContain("mt-0");
    expect(collapsedClassName).not.toContain("mt-1");
    expect(collapsedClassName).toContain("font-medium");
    expect(collapsedClassName).not.toContain("font-normal");
    const expandedClassName = notificationDescriptionClassName(true);
    expect(expandedClassName).toContain("-mt-px");
    expect(expandedClassName).not.toContain("mt-0");
    expect(expandedClassName).not.toContain("mt-1");
  });

  test("adds first-line emphasis when requested", () => {
    expect(notificationDescriptionClassName(false, true)).toContain(
      "first-line:font-bold",
    );
    expect(notificationDescriptionClassName(false, false)).not.toContain(
      "first-line:font-bold",
    );
    const expandedClassName = notificationDescriptionClassName(true, true);
    expect(expandedClassName).toContain("max-h-[81px]");
    expect(expandedClassName).toContain("overflow-y-auto");
    expect(expandedClassName).toContain("first-line:font-bold");
    expect(expandedClassName).toContain("tracking-tight");
    expect(expandedClassName).not.toContain("tracking-[-0.01em]");
  });

  test("requests first-line emphasis only for registered multiline bodies", () => {
    expect(
      shouldEmphasizeNotificationFirstLine(
        "/images/notification-apps/messages.jpg",
        54,
      ),
    ).toBe(true);
    expect(
      shouldEmphasizeNotificationFirstLine(
        "/images/notification-apps/messages.jpg",
        27,
      ),
    ).toBe(false);
    expect(shouldEmphasizeNotificationFirstLine(null, 54)).toBe(false);
  });

  test("detects bodies taller than one rendered line", () => {
    expect(hasMultipleNotificationDescriptionLines(27)).toBe(false);
    expect(hasMultipleNotificationDescriptionLines(28)).toBe(false);
    expect(hasMultipleNotificationDescriptionLines(29)).toBe(true);
    expect(hasMultipleNotificationDescriptionLines(54)).toBe(true);
  });

  test("keeps expanded notification text in a bounded scroll viewport", () => {
    const className = notificationDescriptionClassName(true);
    const classNameWithAppName = notificationDescriptionClassName(
      true,
      false,
      true,
    );
    expect(className).toContain("whitespace-pre-wrap break-words");
    expect(className).toContain("max-h-[81px]");
    expect(className).toContain("overflow-y-auto");
    expect(className).toContain("overscroll-contain");
    expect(className).toContain("scrollbar-hide");
    expect(className).not.toContain("line-clamp");
    expect(classNameWithAppName).toContain("max-h-[54px]");
    expect(classNameWithAppName).not.toContain("max-h-[81px]");
  });

  test("temporarily hides sibling notifications while one is expanded", () => {
    const notifications = [
      { id: "one", title: "One", description: "First" },
      { id: "two", title: "Two", description: "Second" },
      { id: "three", title: "Three", description: "Third" },
    ];
    expect(visibleNotificationsForExpandedId(notifications, null)).toEqual(
      notifications,
    );
    expect(visibleNotificationsForExpandedId(notifications, "two")).toEqual([
      notifications[1],
    ]);
    expect(visibleNotificationsForExpandedId(notifications, "removed")).toEqual(
      notifications,
    );
  });
});

describe("notification bridge lifecycle", () => {
  test("uses the update glyph for connector update notices", () => {
    const harness = createHarness();
    harness.controller.handle(
      event("notification.show", {
        id: "connector.ota.available.v3.1.0",
        title: "Connector update available",
        body: "Version 3.1.0 is ready.",
        category: "connector.ota.available",
      }),
    );

    expect(harness.added).toHaveLength(1);
    expect(harness.added[0].icon).toBe(SettingsUpdateIcon);
  });

  test("suppresses mirrored phone notifications while preserving system notices", () => {
    const harness = createHarness({ mirroredPresentationEnabled: false });
    harness.controller.handle(
      event("notification.show", {
        id: "android:hidden",
        title: "Hidden Android message",
        category: "android.message",
      }),
    );
    harness.controller.handle(
      event("notification.show", {
        id: "ancs:hidden",
        title: "Hidden message",
        category: "ios.social",
      }),
    );
    harness.controller.handle(
      event("notification.show", {
        id: "subscription.notice",
        title: "Subscription notice",
        category: "subscription.expiry",
      }),
    );

    expect(harness.added.map(({ title }) => title)).toEqual([
      "Subscription notice",
    ]);
    expect(harness.timers.size).toBe(0);
  });

  test("disabling presentation clears only active mirrored banners and timers", () => {
    const harness = createHarness();
    harness.controller.handle(
      event("notification.show", {
        id: "system.notice",
        title: "System notice",
        category: "subscription.expiry",
      }),
    );
    harness.controller.handle(
      event("notification.show", {
        id: "ancs:active",
        title: "Active message",
        category: "ios.social",
      }),
    );

    harness.controller.setMirroredPresentationEnabled(false);

    expect(harness.removed).toEqual(["internal-2"]);
    expect(harness.cancelledTimers).toEqual([1]);
    expect(harness.timers.size).toBe(0);

    harness.controller.handle(
      event("notification.show", {
        id: "ancs:still-hidden",
        title: "Still hidden",
        category: "ios.other",
      }),
    );
    harness.controller.setMirroredPresentationEnabled(true);
    harness.controller.handle(
      event("notification.show", {
        id: "ancs:new",
        title: "New message",
        category: "ios.other",
      }),
    );

    expect(harness.added.map(({ title }) => title)).toEqual([
      "System notice",
      "Active message",
      "New message",
    ]);
    expect(harness.timers.size).toBe(1);
  });

  test("replaces an updated mirrored notification and routes its removal", () => {
    const harness = createHarness();
    harness.controller.handle(
      event("notification.show", {
        id: "ancs:7",
        title: "First",
        category: "ios.social",
        app_name: "Messages",
        app_bundle_id: "com.apple.MobileSMS",
      }),
    );
    expect(harness.added[0]).toMatchObject({
      icon: SmartphoneIcon,
      iconSrc: "/images/notification-apps/messages.jpg",
      appName: "Messages",
    });
    expect([...harness.timers.values()][0].delayMs).toBe(8000);

    harness.controller.handle(
      event("notification.show", {
        id: "ancs:7",
        title: "Updated",
        category: "ios.social",
      }),
    );
    expect(harness.removed).toEqual(["internal-1"]);
    expect(harness.added.map(({ title }) => title)).toEqual([
      "First",
      "Updated",
    ]);
    expect(harness.cancelledTimers).toEqual([1]);

    harness.controller.handle(event("notification.remove", { id: "ancs:7" }));
    expect(harness.removed).toEqual(["internal-1", "internal-2"]);
    expect(harness.cancelledTimers).toEqual([1, 2]);
    expect(harness.timers.size).toBe(0);
  });

  test("bounds iOS and Android banners in one mirrored notification queue", () => {
    const harness = createHarness();
    for (let index = 1; index <= 4; index += 1) {
      harness.controller.handle(
        event("notification.show", {
          id: `phone:${index}`,
          title: `Notification ${index}`,
          category: index % 2 === 0 ? "android.other" : "ios.other",
        }),
      );
    }
    expect(harness.removed).toEqual(["internal-1"]);
    expect(harness.timers.size).toBe(3);

    harness.timers.get(2).callback();
    expect(harness.removed).toEqual(["internal-1", "internal-2"]);
    expect(harness.timers.size).toBe(2);
  });

  test("manual dismissal forgets external state without double-removing", () => {
    const harness = createHarness();
    harness.controller.handle(
      event("notification.show", {
        id: "ancs:11",
        title: "Dismiss me",
        category: "ios.other",
      }),
    );
    harness.added[0].onDismiss();
    harness.controller.handle(event("notification.remove", { id: "ancs:11" }));

    expect(harness.removed).toEqual([]);
    expect(harness.cancelledTimers).toEqual([1]);
  });

  test("suppresses pre-existing mirrored notifications and preserves auth cleanup", () => {
    const harness = createHarness();
    for (const category of ["ios.other", "android.other"]) {
      harness.controller.handle(
        event("notification.show", {
          id: `${category}:old`,
          title: "Old",
          category,
          pre_existing: true,
        }),
      );
    }
    expect(harness.added).toEqual([]);

    const reconnect = {
      id: "spotify.auth.reconnecting",
      title: "Reconnect Spotify",
      category: "spotify.auth.reconnecting",
    };
    harness.controller.handle(event("notification.show", reconnect));
    harness.controller.handle(event("notification.show", reconnect));
    expect(harness.added).toHaveLength(1);

    harness.controller.handle(
      event("spotify.auth.status", { authenticated: true }),
    );
    expect(harness.removed).toEqual(["internal-1"]);
  });

  test("generates ids for anonymous mirrored events and clears timers on dispose", () => {
    const harness = createHarness();
    harness.controller.handle(
      event("notification.show", {
        title: "Anonymous",
        category: "ios.other",
      }),
    );
    expect(harness.timers.size).toBe(1);

    harness.controller.dispose();
    expect(harness.cancelledTimers).toEqual([1]);
    expect(harness.timers.size).toBe(0);
  });

  test("keeps the generic phone icon for an unknown mirrored app", () => {
    const harness = createHarness();
    harness.controller.handle(
      event("notification.show", {
        id: "ancs:unknown",
        title: "Unknown app",
        category: "ios.other",
        app_bundle_id: "com.example.unknown",
      }),
    );

    expect(harness.added[0].icon).toBe(SmartphoneIcon);
    expect(harness.added[0].iconSrc).toBeNull();
  });

  test("uses known Android app artwork for mirrored notifications", () => {
    const harness = createHarness();
    harness.controller.handle(
      event("notification.show", {
        id: "android:messages",
        title: "Android message",
        category: "android.message",
        app_bundle_id: "com.google.android.apps.messaging",
      }),
    );

    expect(harness.added[0].icon).toBe(SmartphoneIcon);
    expect(harness.added[0].iconSrc).toBe(
      "/images/notification-apps/google-messages.png",
    );
    expect([...harness.timers.values()][0].delayMs).toBe(8000);
  });

  test("does not apply mirrored app artwork to a system notification", () => {
    const harness = createHarness();
    harness.controller.handle(
      event("notification.show", {
        id: "subscription.notice",
        title: "Subscription notice",
        category: "subscription.expiry",
        app_bundle_id: "com.apple.MobileSMS",
      }),
    );

    expect(harness.added[0].iconSrc).toBeNull();
  });
});

describe("OTA update notifications", () => {
  test("shows one persistent system notice when automatic updates are disabled", () => {
    const harness = createOtaNoticeHarness();
    const snapshot = otaNoticeSnapshot();

    harness.controller.sync(snapshot);
    harness.controller.sync(snapshot);

    expect(harness.added).toHaveLength(1);
    expect(harness.added[0]).toMatchObject({
      icon: SettingsUpdateIcon,
      appName: "Nocturne",
      title: "Nocturne update available",
    });
    expect(harness.added[0].description).toContain(availableUpdate.version);
    expect(harness.removed).toEqual([]);
  });

  test("does not immediately restore a dismissed release", () => {
    const harness = createOtaNoticeHarness();
    const snapshot = otaNoticeSnapshot();
    harness.controller.sync(snapshot);

    harness.added[0].onDismiss();
    harness.controller.sync(snapshot);

    expect(harness.added).toHaveLength(1);

    harness.controller.sync(
      otaNoticeSnapshot({
        available: { ...availableUpdate, version: "4.2.1+20260728020000" },
      }),
    );
    expect(harness.added).toHaveLength(2);
  });

  test("removes the notice when automatic installation or OTA lifecycle takes over", () => {
    const harness = createOtaNoticeHarness();
    harness.controller.sync(otaNoticeSnapshot());
    harness.controller.sync(otaNoticeSnapshot({ autoUpdateEnabled: true }));

    expect(harness.removed).toEqual(["ota-internal-1"]);

    harness.controller.sync(otaNoticeSnapshot());
    harness.controller.sync(otaNoticeSnapshot({ isInstallPending: true }));
    expect(harness.removed).toEqual(["ota-internal-1", "ota-internal-2"]);
  });

  test("keeps a reflash-only release visible and clears stale check results", () => {
    const harness = createOtaNoticeHarness();
    const reflash = { ...availableUpdate, requiresReflash: true };

    expect(otaUpdateNotificationKey(true, availableUpdate)).toBeNull();
    expect(otaUpdateNotificationKey(true, reflash)).not.toBeNull();

    harness.controller.sync(
      otaNoticeSnapshot({ autoUpdateEnabled: true, available: reflash }),
    );
    expect(harness.added[0].description).toContain("computer reflash");

    harness.controller.sync(
      otaNoticeSnapshot({ available: null, lastCheckResult: "upToDate" }),
    );
    expect(harness.removed).toEqual(["ota-internal-1"]);
  });
});
