import type {
  ComponentType,
  Dispatch,
  ReactNode,
  SetStateAction,
  SVGProps,
} from "react";

export type UnknownRecord = Record<string, unknown>;
export type Nullable<T> = T | null;
export type VoidCallback = () => void;
export type AsyncVoidCallback = () => Promise<void>;
export type StateSetter<T> = Dispatch<SetStateAction<T>>;

export type IconProps = SVGProps<SVGSVGElement> & {
  className?: string;
  percentage?: number;
  size?: number;
};

export type ChildrenProps = {
  children: ReactNode;
};

export type ContentType =
  | "album"
  | "artist"
  | "playlist"
  | "show"
  | "mix"
  | "liked-songs"
  | "track"
  | "episode"
  | "radio"
  | string;

export type ActiveSection =
  | "nowPlaying"
  | "recents"
  | "library"
  | "artists"
  | "radio"
  | "podcasts"
  | "settings"
  | "network"
  | "lock"
  | "auth"
  | "splash"
  | string;

export interface SpotifyImage {
  url?: string;
  width?: number | null;
  height?: number | null;
  [key: string]: unknown;
}

export interface SpotifyArtist {
  followers?: { total?: number };
  id?: string;
  uri?: string;
  name?: string;
  type?: string;
  images?: SpotifyImage[];
  [key: string]: unknown;
}

export interface SpotifyAlbum {
  id?: string;
  uri?: string;
  name?: string;
  type?: string;
  images?: SpotifyImage[];
  artists?: SpotifyArtist[];
  release_date?: string;
  total_tracks?: number;
  tracks?: SpotifyPaging<SpotifyTrack> & { total?: number };
  [key: string]: unknown;
}

export interface SpotifyEpisode {
  release_date?: string;
  explicit?: boolean;
  id?: string;
  uri?: string;
  name?: string;
  type?: string;
  images?: SpotifyImage[];
  duration_ms?: number;
  description?: string;
  show?: SpotifyShow;
  [key: string]: unknown;
}

export interface SpotifyTrack {
  explicit?: boolean;
  id?: string;
  uri?: string;
  name?: string;
  type?: string;
  images?: SpotifyImage[];
  album?: SpotifyAlbum;
  artists?: SpotifyArtist[];
  duration_ms?: number;
  is_playing?: boolean;
  is_local?: boolean;
  is_phone_media?: boolean;
  is_liked?: boolean;
  like_supported?: boolean;
  phone_media_album_name?: string | null;
  linked_from?: { uri?: string; id?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface SpotifyPlaylist {
  description?: string;
  trackCount?: number;
  id?: string;
  uri?: string;
  name?: string;
  type?: string;
  images?: SpotifyImage[];
  owner?: { id?: string; display_name?: string; [key: string]: unknown };
  tracks?: SpotifyPaging<SpotifyTrack> & { total?: number };
  [key: string]: unknown;
}

export interface SpotifyShow {
  id?: string;
  uri?: string;
  name?: string;
  type?: string;
  images?: SpotifyImage[];
  publisher?: string;
  episodes?: SpotifyPaging<SpotifyEpisode>;
  [key: string]: unknown;
}

export interface SpotifyPaging<T> {
  items?: T[];
  total?: number;
  limit?: number;
  offset?: number;
  next?: string | null;
  previous?: string | null;
  [key: string]: unknown;
}

export type SpotifyContent =
  | SpotifyAlbum
  | SpotifyArtist
  | SpotifyPlaylist
  | SpotifyShow
  | SpotifyTrack
  | SpotifyEpisode;

export interface SpotifyDevice {
  device_id?: string;
  device_type?: string;
  id?: string | null;
  name?: string;
  type?: string;
  is_active?: boolean;
  is_private_session?: boolean;
  is_restricted?: boolean;
  volume_percent?: number | null;
  connected?: boolean;
  address?: string;
  [key: string]: unknown;
}

export interface SpotifyPlayback {
  item?: SpotifyPlaybackItem | null;
  is_playing?: boolean;
  progress_ms?: number | null;
  device?: SpotifyDevice | null;
  context?: { uri?: string; type?: string; [key: string]: unknown } | null;
  currently_playing_type?: string;
  timestamp?: number;
  [key: string]: unknown;
}

export interface PlaybackProgress {
  progressMs: number;
  durationMs?: number;
  duration: number;
  isPlaying: boolean;
  trackId: string | null;
  progressPercentage: number;
  updateProgress: (newProgressMs: number) => void;
  triggerRefresh: () => void;
}

export type GradientInput = string | string[] | null;

export interface GradientState {
  imageURL: GradientInput;
  section: string | null;
}

export type UpdateGradientColors = (
  imageURL?: GradientInput,
  section?: string | null,
) => void;

export interface ViewingContent {
  id: string;
  type: ContentType;
  item?: SpotifyContent | null;
}

export interface BluetoothDevice {
  alias?: string;
  device_info?: { name?: string };
  address?: string;
  name?: string;
  paired?: boolean;
  connected?: boolean;
  trusted?: boolean;
  rssi?: number | null;
  icon?: string | null;
  [key: string]: unknown;
}

export interface BluetoothConnectionState {
  devices: BluetoothDevice[];
  connectedDevices: BluetoothDevice[];
  lastConnectedDevice: BluetoothDevice | null;
  isConnecting: boolean;
  isReconnecting: boolean;
  reconnectAttempt: number;
  reconnectionExhausted: boolean;
}

export interface PairingRequest {
  requestId?: string;
  pairingKey?: string;
  pin?: string;
  device?: BluetoothDevice | string;
  address?: string;
  [key: string]: unknown;
}

export interface WsResponse<T = unknown> {
  id?: string;
  requestId?: string;
  method?: string;
  topic?: string;
  type?: string;
  status?: string;
  connected?: boolean;
  data?: T;
  payload?: T;
  result?: T;
  error?: unknown;
  [key: string]: unknown;
}

export interface WsMessage<T = unknown> {
  topic?: string;
  type?: string;
  method?: string;
  data?: T;
  payload?: T;
  result?: T;
  [key: string]: unknown;
}

export interface SettingsState {
  use24HourTime?: boolean;
  trackNameScrollingEnabled?: boolean;
  showLyricsGestureEnabled?: boolean;
  songChangeGestureEnabled?: boolean;
  lyricsMenuEnabled?: boolean;
  elapsedTimeEnabled?: boolean;
  idleLockEnabled?: boolean;
  idleDisplaySleepEnabled?: boolean;
  remainingTimeEnabled?: boolean;
  showStatusBar?: boolean;
  startWithNowPlaying?: boolean;
  autoUpdateEnabled?: boolean;
  betaUpdatesEnabled?: boolean;
  knobSeeksPlaybackEnabled?: boolean;
  mockingbirdUiEnabled?: boolean;
  micMuted?: boolean;
  foregroundAppLaunchEnabled?: boolean;
  nativePhoneCallsEnabled?: boolean;
  nativeNotificationsEnabled?: boolean;
  showPlaybackTime?: boolean;
  useRemainingTime?: boolean;
  artistNameScrollingEnabled?: boolean;
  albumNameScrollingEnabled?: boolean;
  enableGestures?: boolean;
  enableKnobControl?: boolean;
  highQualityImages?: boolean;
  [key: string]: boolean | string | number | null | undefined;
}

export interface SettingsContextValue {
  settings: SettingsState;
  updateSetting: (
    key: keyof SettingsState | string,
    value: boolean | string | number | null,
  ) => void;
  isAppLaunchSettingReady: boolean;
  isAppLaunchSettingSaving: boolean;
  appLaunchSettingError: string | null;
  isMicLocked: boolean;
  appPlatform: string | null;
  isNativePhonePresentationLocked: boolean;
  nativePhonePresentationLockMessage: string | null;
  showNativePhoneCalls: boolean;
  showNativeNotifications: boolean;
}

export interface NotificationAction {
  label: string;
  onPress: VoidCallback;
}

export type NotificationIcon = string | ComponentType<IconProps>;

export interface AppNotification {
  id: string;
  icon?: NotificationIcon | null;
  iconSrc?: string | null;
  appName?: string | null;
  title: string;
  description: string;
  action?: NotificationAction | null;
  onDismiss?: VoidCallback | null;
}

export interface NotificationContextValue {
  notifications: AppNotification[];
  addNotification: (notification: Omit<AppNotification, "id">) => string;
  removeNotification: (id: string) => void;
}

export interface NocturneRequestOptions {
  timeoutMs?: number;
}

// ── Hook contract types (packages/ui/src/hooks) ──

/**
 * Handlers registered against the singleton daemon WebSocket. Payload fields of
 * the dispatched message (`data`/`result`/`payload`) are untrusted JSON.
 */
export interface NocturneWsHandlers {
  onOpen?: (socket: WebSocket) => void;
  onClose?: () => void;
  onError?: (error: unknown) => void;
  onMessage?: (message: WsResponse) => void;
}

export interface AppReadyState {
  ready: boolean;
  platform: string | null;
  generation: number;
}

export interface AppSubscribedState {
  subscribed: boolean;
  status: string | null;
  hasLifetime: boolean;
  isAdmin: boolean;
  entitlementsVerified: boolean;
}

export interface BtReconnectState {
  attempts: number;
  inProgress: boolean;
  exhausted: boolean;
}

export interface BluetoothConnectionSnapshot {
  connected: boolean;
  devices: Array<{ address?: string; connected: boolean }>;
}

export interface UpdateCommands {
  pre?: string[];
  post?: string[];
}

/** OTA release/update descriptor used by update presentation. */
export interface UpdateInfo {
  hasUpdate?: boolean;
  canUpdate?: boolean;
  nextInChain?: boolean;
  totalUpdates?: number;
  version?: string;
  tag?: string;
  shortDescription?: string;
  fullDescription?: string;
  releaseNotes?: string;
  releaseDate?: string;
  releaseSize?: number;
  imageUrl?: string;
  assetUrls?: Record<string, string>;
  assetSums?: Record<string, string>;
  minimumVersion?: string;
  channel?: string;
  critical?: boolean;
  commands?: UpdateCommands;
}

/** Seek/resync anchor passed from useSpotifyPlayerState to usePlaybackProgress. */
export interface ProgressResetSignal {
  position: number;
  timestamp: number;
}

// ── Mockingbird bridge contracts (Nocturne props → CarThing RootStore) ──
// Consumed by CarThingStore.tsx, useCarThingSpotifyIntegration.ts, and the
// mockingbird stores. Distinct from SpotifyPlayback/PlaybackProgress above:
// these describe the looser, host-app-shaped objects bridged through props.

/** Permissive now-playing item: a Spotify track or episode as surfaced by the host app. */
export interface SpotifyPlaybackItem {
  is_local?: boolean;
  is_spotify_pending?: boolean;
  is_liked?: boolean;
  like_supported?: boolean;
  release_date?: string;
  explicit?: boolean;
  linked_from?: { uri?: string; id?: string; [key: string]: unknown };
  uri?: string;
  id?: string;
  name?: string;
  type?: string;
  duration_ms?: number;
  images?: SpotifyImage[];
  album?: SpotifyAlbum;
  artists?: SpotifyArtist[];
  show?: SpotifyShow;
  is_phone_media?: boolean;
  phone_media_album_name?: string | null;
  [key: string]: unknown;
}

/** Playback snapshot bridged from Nocturne's player state into the CarThing stores. */
export interface SpotifyPlaybackState {
  actions?: { disallows?: Partial<Record<string, boolean>> };
  playback_speed?: number;
  item?: SpotifyPlaybackItem | null;
  is_playing?: boolean;
  progress_ms?: number | null;
  shuffle_state?: boolean;
  repeat_state?: string;
  context?: { uri?: string; type?: string; [key: string]: unknown } | null;
  device?: SpotifyDevice | null;
  currently_active_application?: string | null;
  currently_playing_type?: string;
  timestamp?: number;
  [key: string]: unknown;
}

/** A saved show as surfaced in `SpotifyDataState`, either wrapped or flattened. */
export interface SpotifyShowEntry extends SpotifyShow {
  added_at?: string;
  show?: SpotifyShow;
  id?: string;
  uri?: string;
  name?: string;
  images?: SpotifyImage[];
  publisher?: string;
  [key: string]: unknown;
}

/** A saved album as surfaced in `SpotifyDataState`, either wrapped or flattened. */
export interface SpotifyAlbumEntry {
  album?: SpotifyAlbum;
  id?: string;
  uri?: string;
  name?: string;
  images?: SpotifyImage[];
  artists?: SpotifyArtist[];
  [key: string]: unknown;
}

/** Aggregate Spotify library/state blob bridged from Nocturne into the Shelf. */
export interface SpotifyDataState {
  initialDataLoaded?: boolean;
  spotifyUserId?: string | null;
  recentAlbums?: SpotifyAlbum[];
  likedSongs?: {
    tracks?: { total?: number; [key: string]: unknown };
    images?: SpotifyImage[];
    [key: string]: unknown;
  } | null;
  userPlaylists?: SpotifyPlaylist[];
  userShows?: SpotifyShowEntry[];
  topArtists?: SpotifyArtist[];
  userAlbums?: SpotifyAlbumEntry[];
  [key: string]: unknown;
}

/** Spotify player controls bridged from Nocturne's hooks into the CarThing stores. */
export type PlayerControls = Partial<
  Pick<
    ReturnType<
      typeof import("./hooks/useSpotifyPlayerControls").useSpotifyPlayerControls
    >,
    | "playTrack"
    | "playDJMix"
    | "sendDJSignal"
    | "pausePlayback"
    | "skipToNext"
    | "skipToPrevious"
    | "toggleShuffle"
    | "likeTrack"
    | "unlikeTrack"
    | "checkIsTrackLiked"
    | "likeTarget"
    | "likeCurrentItem"
    | "unlikeCurrentItem"
    | "checkCurrentItemLiked"
    | "seekToPosition"
    | "setRepeatMode"
    | "setVolume"
    | "volume"
    | "phoneMediaPlay"
    | "phoneMediaPause"
    | "phoneMediaNext"
    | "phoneMediaPrevious"
    | "phoneMediaVolumeUp"
    | "phoneMediaVolumeDown"
  >
>;
