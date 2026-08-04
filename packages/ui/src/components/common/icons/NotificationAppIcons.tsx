interface NotificationAppIconCatalogEntry {
  name: string;
  bundleIds: readonly string[];
  src: string;
}

const iconSrc = (fileName: string, extension = "jpg") =>
  `/images/notification-apps/${fileName}.${extension}`;

export const NOTIFICATION_APP_ICON_CATALOG: readonly NotificationAppIconCatalogEntry[] =
  [
    {
      name: "Messages",
      bundleIds: ["com.apple.MobileSMS"],
      src: iconSrc("messages"),
    },
    {
      name: "Phone",
      bundleIds: ["com.apple.mobilephone"],
      src: iconSrc("phone"),
    },
    {
      name: "Google Messages",
      bundleIds: ["com.google.android.apps.messaging"],
      src: iconSrc("google-messages", "png"),
    },
    {
      name: "Phone by Google",
      bundleIds: ["com.google.android.dialer"],
      src: iconSrc("google-phone", "png"),
    },
    {
      name: "FaceTime",
      bundleIds: ["com.apple.facetime"],
      src: iconSrc("facetime"),
    },
    {
      name: "Snapchat",
      bundleIds: ["com.toyopagroup.picaboo", "com.snapchat.android"],
      src: iconSrc("snapchat"),
    },
    {
      name: "Instagram",
      bundleIds: ["com.burbn.instagram", "com.instagram.android"],
      src: iconSrc("instagram"),
    },
    {
      name: "YouTube",
      bundleIds: ["com.google.ios.youtube", "com.google.android.youtube"],
      src: iconSrc("youtube"),
    },
    {
      name: "WhatsApp",
      bundleIds: ["net.whatsapp.WhatsApp", "com.whatsapp"],
      src: iconSrc("whatsapp"),
    },
    {
      name: "Messenger",
      bundleIds: ["com.facebook.Messenger", "com.facebook.orca"],
      src: iconSrc("messenger"),
    },
    {
      name: "TikTok",
      bundleIds: ["com.zhiliaoapp.musically"],
      src: iconSrc("tiktok"),
    },
    {
      name: "Gmail",
      bundleIds: ["com.google.Gmail", "com.google.android.gm"],
      src: iconSrc("gmail"),
    },
    {
      name: "Google Calendar",
      bundleIds: ["com.google.android.calendar"],
      src: iconSrc("google-calendar", "png"),
    },
    {
      name: "Google Home",
      bundleIds: ["com.google.android.apps.chromecast.app"],
      src: iconSrc("google-home", "png"),
    },
    {
      name: "Google",
      bundleIds: ["com.google.android.googlequicksearchbox"],
      src: iconSrc("google", "png"),
    },
    {
      name: "Maps",
      bundleIds: ["com.apple.Maps"],
      src: iconSrc("apple-maps"),
    },
    {
      name: "Find My",
      bundleIds: [
        "com.apple.findmy",
        "com.apple.FindMySafetyAlertsNotifications",
        "com.apple.mobileme.fmip1",
        "com.apple.mobileme.fmf1",
      ],
      src: iconSrc("find-my"),
    },
    {
      name: "Google Maps",
      bundleIds: ["com.google.Maps", "com.google.android.apps.maps"],
      src: iconSrc("google-maps"),
    },
    {
      name: "Discord",
      bundleIds: ["com.hammerandchisel.discord", "com.discord"],
      src: iconSrc("discord"),
    },
    {
      name: "Telegram",
      bundleIds: ["ph.telegra.Telegraph", "org.telegram.messenger"],
      src: iconSrc("telegram"),
    },
    {
      name: "X",
      bundleIds: ["com.atebits.Tweetie2", "com.twitter.android"],
      src: iconSrc("x"),
    },
    {
      name: "Reddit",
      bundleIds: ["com.reddit.Reddit", "com.reddit.frontpage"],
      src: iconSrc("reddit"),
    },
    {
      name: "Slack",
      bundleIds: ["com.tinyspeck.chatlyio", "com.Slack"],
      src: iconSrc("slack"),
    },
    {
      name: "Mail",
      bundleIds: ["com.apple.mobilemail"],
      src: iconSrc("mail"),
    },
    {
      name: "Calendar",
      bundleIds: ["com.apple.mobilecal"],
      src: iconSrc("calendar"),
    },
    {
      name: "Facebook",
      bundleIds: ["com.facebook.Facebook", "com.facebook.katana"],
      src: iconSrc("facebook"),
    },
    {
      name: "LinkedIn",
      bundleIds: ["com.linkedin.LinkedIn", "com.linkedin.android"],
      src: iconSrc("linkedin"),
    },
    {
      name: "Outlook",
      bundleIds: [
        "com.microsoft.Office.Outlook",
        "com.microsoft.office.outlook",
      ],
      src: iconSrc("outlook"),
    },
    {
      name: "Microsoft Teams",
      bundleIds: ["com.microsoft.skype.teams", "com.microsoft.teams"],
      src: iconSrc("teams"),
    },
    {
      name: "Signal",
      bundleIds: ["org.whispersystems.signal", "org.thoughtcrime.securesms"],
      src: iconSrc("signal"),
    },
    {
      name: "Twitch",
      bundleIds: ["tv.twitch", "tv.twitch.android.app"],
      src: iconSrc("twitch"),
    },
    {
      name: "Pinterest",
      bundleIds: ["pinterest", "com.pinterest"],
      src: iconSrc("pinterest"),
    },
  ];

const APP_ICON_SRC_BY_BUNDLE_ID = new Map<string, string>();

for (const entry of NOTIFICATION_APP_ICON_CATALOG) {
  for (const bundleId of entry.bundleIds) {
    APP_ICON_SRC_BY_BUNDLE_ID.set(bundleId.toLowerCase(), entry.src);
  }
}

export const notificationIconSrcForBundleId = (
  bundleId: string | null,
): string | null => {
  if (!bundleId) return null;
  return APP_ICON_SRC_BY_BUNDLE_ID.get(bundleId.trim().toLowerCase()) ?? null;
};
