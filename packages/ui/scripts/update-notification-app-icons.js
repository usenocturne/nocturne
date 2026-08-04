import { mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";

const appStoreApps = [
  {
    name: "Messages",
    slug: "messages",
    trackId: 1146560473,
    bundleId: "com.apple.MobileSMS",
  },
  {
    name: "Phone",
    slug: "phone",
    trackId: 1146562108,
    bundleId: "com.apple.mobilephone",
  },
  {
    name: "FaceTime",
    slug: "facetime",
    trackId: 1110145091,
    bundleId: "com.apple.facetime",
  },
  {
    name: "Snapchat",
    slug: "snapchat",
    trackId: 447188370,
    bundleId: "com.toyopagroup.picaboo",
  },
  {
    name: "Instagram",
    slug: "instagram",
    trackId: 389801252,
    bundleId: "com.burbn.instagram",
  },
  {
    name: "YouTube",
    slug: "youtube",
    trackId: 544007664,
    bundleId: "com.google.ios.youtube",
  },
  {
    name: "WhatsApp",
    slug: "whatsapp",
    trackId: 310633997,
    bundleId: "net.whatsapp.WhatsApp",
  },
  {
    name: "Messenger",
    slug: "messenger",
    trackId: 454638411,
    bundleId: "com.facebook.Messenger",
  },
  {
    name: "TikTok",
    slug: "tiktok",
    trackId: 835599320,
    bundleId: "com.zhiliaoapp.musically",
  },
  {
    name: "Gmail",
    slug: "gmail",
    trackId: 422689480,
    bundleId: "com.google.Gmail",
  },
  {
    name: "Maps",
    slug: "apple-maps",
    trackId: 915056765,
    bundleId: "com.apple.Maps",
  },
  {
    name: "Find My",
    slug: "find-my",
    trackId: 1514844621,
    bundleId: "com.apple.findmy",
  },
  {
    name: "Google Maps",
    slug: "google-maps",
    trackId: 585027354,
    bundleId: "com.google.Maps",
  },
  {
    name: "Discord",
    slug: "discord",
    trackId: 985746746,
    bundleId: "com.hammerandchisel.discord",
  },
  {
    name: "Telegram",
    slug: "telegram",
    trackId: 686449807,
    bundleId: "ph.telegra.Telegraph",
  },
  {
    name: "X",
    slug: "x",
    trackId: 333903271,
    bundleId: "com.atebits.Tweetie2",
  },
  {
    name: "Reddit",
    slug: "reddit",
    trackId: 1064216828,
    bundleId: "com.reddit.Reddit",
  },
  {
    name: "Slack",
    slug: "slack",
    trackId: 618783545,
    bundleId: "com.tinyspeck.chatlyio",
  },
  {
    name: "Mail",
    slug: "mail",
    trackId: 1108187098,
    bundleId: "com.apple.mobilemail",
  },
  {
    name: "Calendar",
    slug: "calendar",
    trackId: 1108185179,
    bundleId: "com.apple.mobilecal",
  },
  {
    name: "Facebook",
    slug: "facebook",
    trackId: 284882215,
    bundleId: "com.facebook.Facebook",
  },
  {
    name: "LinkedIn",
    slug: "linkedin",
    trackId: 288429040,
    bundleId: "com.linkedin.LinkedIn",
  },
  {
    name: "Outlook",
    slug: "outlook",
    trackId: 951937596,
    bundleId: "com.microsoft.Office.Outlook",
  },
  {
    name: "Microsoft Teams",
    slug: "teams",
    trackId: 1113153706,
    bundleId: "com.microsoft.skype.teams",
  },
  {
    name: "Signal",
    slug: "signal",
    trackId: 874139669,
    bundleId: "org.whispersystems.signal",
  },
  { name: "Twitch", slug: "twitch", trackId: 460177396, bundleId: "tv.twitch" },
  {
    name: "Pinterest",
    slug: "pinterest",
    trackId: 429047995,
    bundleId: "pinterest",
  },
];

const googlePlayApps = [
  {
    name: "Google Messages",
    slug: "google-messages",
    packageId: "com.google.android.apps.messaging",
  },
  {
    name: "Phone by Google",
    slug: "google-phone",
    packageId: "com.google.android.dialer",
  },
  {
    name: "Google Calendar",
    slug: "google-calendar",
    packageId: "com.google.android.calendar",
  },
  {
    name: "Google Home",
    slug: "google-home",
    packageId: "com.google.android.apps.chromecast.app",
  },
  {
    name: "Google",
    slug: "google",
    packageId: "com.google.android.googlequicksearchbox",
  },
];

const lookupUrl = new URL("https://itunes.apple.com/lookup");
lookupUrl.searchParams.set(
  "id",
  appStoreApps.map(({ trackId }) => trackId).join(","),
);
lookupUrl.searchParams.set("country", "us");

const lookupResponse = await fetch(lookupUrl);
if (!lookupResponse.ok) {
  throw new Error(`App Store lookup failed with HTTP ${lookupResponse.status}`);
}

const lookup = await lookupResponse.json();
if (!lookup || !Array.isArray(lookup.results)) {
  throw new Error("App Store lookup returned an invalid response");
}

const resultsByTrackId = new Map(
  lookup.results.map((result) => [result.trackId, result]),
);
const outputDirectory = path.resolve("public/images/notification-apps");
await mkdir(outputDirectory, { recursive: true });

const expectedArtworkFiles = new Set([
  ...appStoreApps.map(({ slug }) => `${slug}.jpg`),
  ...googlePlayApps.map(({ slug }) => `${slug}.png`),
]);
for (const fileName of await readdir(outputDirectory)) {
  if (
    /\.(?:jpe?g|png)$/i.test(fileName) &&
    !expectedArtworkFiles.has(fileName)
  ) {
    await unlink(path.join(outputDirectory, fileName));
  }
}

const manifest = [];

for (const app of appStoreApps) {
  const result = resultsByTrackId.get(app.trackId);
  if (!result) throw new Error(`Missing App Store result for ${app.name}`);
  if (result.bundleId !== app.bundleId) {
    throw new Error(
      `${app.name} bundle ID changed: expected ${app.bundleId}, received ${result.bundleId}`,
    );
  }
  if (typeof result.artworkUrl512 !== "string") {
    throw new Error(`Missing 512px artwork for ${app.name}`);
  }

  const downloadUrl = result.artworkUrl512.replace(
    /\/\d+x\d+bb\./,
    "/128x128bb.",
  );
  const artworkResponse = await fetch(downloadUrl);
  if (!artworkResponse.ok) {
    throw new Error(
      `${app.name} artwork download failed with HTTP ${artworkResponse.status}`,
    );
  }
  const contentType = artworkResponse.headers.get("content-type") || "";
  if (!contentType.startsWith("image/jpeg")) {
    throw new Error(
      `${app.name} artwork is not JPEG: ${contentType || "unknown"}`,
    );
  }

  const bytes = new Uint8Array(await artworkResponse.arrayBuffer());
  if (
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  ) {
    throw new Error(`${app.name} artwork has an invalid JPEG signature`);
  }

  const fileName = `${app.slug}.jpg`;
  await Bun.write(path.join(outputDirectory, fileName), bytes);
  const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  manifest.push({
    name: app.name,
    bundleId: app.bundleId,
    trackId: app.trackId,
    file: fileName,
    source: result.artworkUrl512,
    sha256: hash,
  });
}

const decodeHtmlAttribute = (value) =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&#38;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");

const readMetaContent = (html, property) => {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attributes = new Map();
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gis)) {
      attributes.set(match[1].toLowerCase(), decodeHtmlAttribute(match[3]));
    }
    if (attributes.get("property") === property) {
      return attributes.get("content") ?? null;
    }
  }
  return null;
};

for (const app of googlePlayApps) {
  const detailsUrl = new URL("https://play.google.com/store/apps/details");
  detailsUrl.searchParams.set("id", app.packageId);
  detailsUrl.searchParams.set("hl", "en_US");
  detailsUrl.searchParams.set("gl", "US");

  const metadataResponse = await fetch(detailsUrl, {
    headers: { "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!metadataResponse.ok) {
    throw new Error(
      `${app.name} Google Play metadata failed with HTTP ${metadataResponse.status}`,
    );
  }

  const metadata = await metadataResponse.text();
  const canonicalUrl = readMetaContent(metadata, "og:url");
  if (!canonicalUrl) {
    throw new Error(`Missing Google Play canonical URL for ${app.name}`);
  }
  if (new URL(canonicalUrl).searchParams.get("id") !== app.packageId) {
    throw new Error(`${app.name} Google Play package ID did not match`);
  }

  const source = readMetaContent(metadata, "og:image");
  if (!source) {
    throw new Error(`Missing Google Play artwork for ${app.name}`);
  }
  const sourceUrl = new URL(source);
  if (
    sourceUrl.protocol !== "https:" ||
    sourceUrl.hostname !== "play-lh.googleusercontent.com"
  ) {
    throw new Error(`${app.name} Google Play artwork has an unexpected host`);
  }

  const downloadUrl = new URL(sourceUrl);
  downloadUrl.hash = "";
  downloadUrl.search = "";
  downloadUrl.pathname = `${downloadUrl.pathname.replace(/=[^/]*$/, "")}=s128`;
  const artworkResponse = await fetch(downloadUrl, {
    headers: { Accept: "image/png" },
  });
  if (!artworkResponse.ok) {
    throw new Error(
      `${app.name} artwork download failed with HTTP ${artworkResponse.status}`,
    );
  }
  const contentType = artworkResponse.headers.get("content-type") || "";
  if (!contentType.startsWith("image/png")) {
    throw new Error(
      `${app.name} artwork is not PNG: ${contentType || "unknown"}`,
    );
  }

  const bytes = new Uint8Array(await artworkResponse.arrayBuffer());
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!pngSignature.every((byte, index) => bytes[index] === byte)) {
    throw new Error(`${app.name} artwork has an invalid PNG signature`);
  }

  const fileName = `${app.slug}.png`;
  await Bun.write(path.join(outputDirectory, fileName), bytes);
  const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  manifest.push({
    name: app.name,
    packageId: app.packageId,
    file: fileName,
    source,
    sha256: hash,
  });
}

await Bun.write(
  path.join(outputDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log(`Updated ${manifest.length} notification app icons`);
