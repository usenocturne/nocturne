export const SUPABASE_URL = "https://qrrtjdmdclkpssjzhzhw.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_sUnSM7qjeWn6rcI9x_fmWg_VJddosT-";

export const SPOTIFY_CLIENT_ID = "65b708073fc0480ea92a077233ca87bd";
export const WEB_PLAYER_CLIENT_ID = "d8a5ed958d274c2e8ee717e6a4b0971d";

export const PORT = Number(process.env.PORT) || 80;

export const OTA_SERVER_URL = "https://ota.usenocturne.com";

export const AUTH_SESSION_PATH = "/etc/nocturne-connector/auth-session.json";
export const SETUP_STATE_PATH = "/etc/nocturne-connector/setup-state.json";

export const SPOTIFY_SCOPES = [
  "app-remote-control",
  "playlist-modify",
  "playlist-modify-private",
  "playlist-modify-public",
  "playlist-read",
  "playlist-read-collaborative",
  "playlist-read-private",
  "streaming",
  "ugc-image-upload",
  "user-follow-modify",
  "user-follow-read",
  "user-library-modify",
  "user-library-read",
  "user-modify",
  "user-modify-playback-state",
  "user-modify-private",
  "user-personalized",
  "user-read-birthdate",
  "user-read-currently-playing",
  "user-read-email",
  "user-read-play-history",
  "user-read-playback-position",
  "user-read-playback-state",
  "user-read-private",
  "user-read-recently-played",
  "user-top-read",
].join(" ");

export const SPOTIFY_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";
export const SPOTIFY_APP_PLATFORM = "WebPlayer";
export const SPOTIFY_APP_VERSION = "1.2.80.313.gd1726b65";

export const SpotifyOperationHash = {
  profileAttributes: "53bcb064f6cd18c23f752bc324a791194d20df612d8e1239c735144ab0399ced",
  getAlbum: "b9bfabef66ed756e5e13f68a942deb60bd4125ec1f1be8cc42769dc0259b4b10",
  getTrack: "612585ae06ba435ad26369870deaae23b5c8800a256cd8a57e08eddc25a37294",
  queryArtistOverview: "446130b4a0aa6522a686aafccddb0ae849165b5e0436fd802f96e0243617b5d8",
  fetchPlaylist: "bb67e0af06e8d6f52b531f97468ee4acd44cd0f82b988e15c2ea47b1148efc77",
  queryShowMetadataV2: "26d0c98fef216dad02d31c359075c07d605974af8d82834f26e90f917f32555a",
  queryPodcastEpisodes: "8e2826c5993383566cc08bf9f5d3301b69513c3f6acb8d706286855e57bf44b2",
  libraryV3: "9f4da031f81274d572cfedaf6fc57a737c84b43d572952200b2c36aaa8fec1c6",
  fetchLibraryTracks: "087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240",
  areEntitiesInLibrary: "134337999233cc6fdd6b1e6dbf94841409f04a946c5c7b744b09ba0dfe5a85ed",
  addToLibrary: "7c5a69420e2bfae3da5cc4e14cbc8bb3f6090f80afc00ffc179177f19be3f33d",
  removeFromLibrary: "7c5a69420e2bfae3da5cc4e14cbc8bb3f6090f80afc00ffc179177f19be3f33d",
  internalLinkRecommenderTrack: "c77098ee9d6ee8ad3eb844938722db60570d040b49f41f5ec6e7be9160a7c86b",
  userTopContent: "49ee15704de4a7fdeac65a02db20604aa11e46f02e809c55d9a89f6db9754356",
  homeSection: "c11ff5d8f508cb1a3dad3f15ee80611cda7df7e6fb45212e466fb3e84a680bf9",
  searchDesktop: "21b3fe49546912ba782db5c47e9ef5a7dbd20329520ba0c7d0fcfadee671d24e",
} as const;

export const RFCOMM_UUID = "00001101-0000-1000-8000-00805f9b34fb";

export const NOCTURNE_SITE_URL = process.env.NOCTURNE_SITE_URL ?? "https://main-nocturne-site.vantalabs.workers.dev/";
