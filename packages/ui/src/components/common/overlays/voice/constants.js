export const PLAY_INTENT = "PLAY";
export const STOP_INTENT = "STOP";
export const SHUFFLE_ON_INTENT = "SHUFFLE_ON";
export const SHUFFLE_OFF_INTENT = "SHUFFLE_OFF";
export const REPEAT_ON_INTENT = "REPEAT_ON";
export const REPEAT_OFF_INTENT = "REPEAT_OFF";
export const REPEAT_ONE_INTENT = "REPEAT_ONE";
export const FOLLOW_INTENT = "FOLLOW";
export const UNFOLLOW_INTENT = "UNFOLLOW";
export const ADD_TO_COLLECTION_INTENT = "ADD_TO_COLLECTION";
export const THUMBS_UP_INTENT = "THUMBS_UP";
export const BAN_TRACK_INTENT = "BAN_TRACK";
export const NEXT_INTENT = "NEXT";
export const PREVIOUS_INTENT = "PREVIOUS";
export const SET_PLAYBACK_SPEED_1X_INTENT = "SET_PLAYBACK_SPEED_1X";
export const SET_PLAYBACK_SPEED_1POINT2X_INTENT = "SET_PLAYBACK_SPEED_1POINT2X";
export const SET_PLAYBACK_SPEED_1POINT5X_INTENT = "SET_PLAYBACK_SPEED_1POINT5X";
export const MUTE_MIC_INTENT = "MUTE_MIC";
export const MUTE_INTENT = "MUTE";
export const ADD_TO_QUEUE_INTENT = "ADD_TO_QUEUE";
export const VOLUME_INTENT = "VOLUME";
export const SHOW_INTENT = "SHOW";
export const NO_INTENT = "NO_INTENT";

export const SAVE_TO_COLLECTION_PODCAST_ACTION = "SAVE_TO_COLLECTION_PODCAST";
export const SAVE_TO_COLLECTION_EPISODE = "SAVE_TO_COLLECTION_EPISODE";

export const CAPTURE_TIMEOUT_MS = 18000;
export const AI_TIMEOUT_MS = 30000;
export const SPEAKING_TIMEOUT_MS = 15000;
export const IDLE_CLOSE_TIMEOUT_MS = 2500;
export const TERMINAL_CLOSE_MS = 8000;
export const PLAY_CLOSE_MS = 10000;
export const OVERLAY_FADE_MS = 300;

export const PILL_TRANSITION_MS = 300;
export const PILL_CROSS_FADE_MS = 200;
export const DOT_PULSE_MS = 1400;
export const STREAM_WORD_MS = 60;
export const THINKING_DIM_OPACITY = 0.4;
export const POST_STREAM_CLOSE_MS = 1500;

function coerceBool(v) {
  if (v === true) return true;
  if (v === false) return false;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "on" || s === "1") return true;
    if (s === "false" || s === "off" || s === "0") return false;
  }
  if (typeof v === "number") return v !== 0;
  return null;
}

export function deriveSimpleIntent(tool, args) {
  if (tool === "spotify_shuffle") {
    const b = coerceBool(args?.state);
    if (b === true) return SHUFFLE_ON_INTENT;
    if (b === false) return SHUFFLE_OFF_INTENT;
    return SHUFFLE_ON_INTENT;
  }
  if (tool === "spotify_shuffle_off") {
    return SHUFFLE_OFF_INTENT;
  }
  if (tool === "spotify_repeat") {
    const s =
      typeof args?.state === "string" ? args.state.trim().toLowerCase() : "";
    if (s === "off") return REPEAT_OFF_INTENT;
    if (s === "track" || s === "one") return REPEAT_ONE_INTENT;
    if (s === "context" || s === "all" || s === "on") return REPEAT_ON_INTENT;
    return REPEAT_ON_INTENT;
  }
  if (tool === "spotify_repeat_off") {
    return REPEAT_OFF_INTENT;
  }
  if (tool === "spotify_follow" || tool === "spotify_unfollow") {
    const uris = Array.isArray(args?.uris)
      ? args.uris
      : typeof args?.uri === "string"
        ? [args.uri]
        : [];
    if (uris.length === 0) return null;
    const allFollowable = uris.every(
      (u) =>
        typeof u === "string" &&
        (u.startsWith("spotify:artist:") || u.startsWith("spotify:show:")),
    );
    if (!allFollowable) return null;
    return tool === "spotify_follow" ? FOLLOW_INTENT : UNFOLLOW_INTENT;
  }
  const directMap = {
    spotify_save_track: ADD_TO_COLLECTION_INTENT,
    spotify_play: PLAY_INTENT,
    spotify_pause: STOP_INTENT,
    spotify_next: NEXT_INTENT,
    spotify_previous: PREVIOUS_INTENT,
    spotify_add_to_queue: ADD_TO_QUEUE_INTENT,
    spotify_remove_track: BAN_TRACK_INTENT,
    spotify_volume: VOLUME_INTENT,
  };
  return directMap[tool] || null;
}

export const INTENT_TO_CONFIRMATION_TEXT = {
  ADD_TO_COLLECTION: "Saved",
  THUMBS_UP: "Saved",
  FOLLOW: "Following",
  UNFOLLOW: "Unfollowed",
  BAN_TRACK: "Removed",
  SHUFFLE_ON: "Shuffle on",
  SHUFFLE_OFF: "Shuffle off",
  REPEAT_ON: "Repeat on",
  REPEAT_ONE: "Repeat one on",
  REPEAT_OFF: "Repeat off",
  SET_PLAYBACK_SPEED_1POINT5X: "Playback speed set",
  SET_PLAYBACK_SPEED_1POINT2X: "Playback speed set",
  SET_PLAYBACK_SPEED_1X: "Playback speed set",
  MUTE_MIC: "Microphone off",
  PLAY: "Playing",
  STOP: "Paused",
  NEXT: "Next",
  PREVIOUS: "Previous",
  ADD_TO_QUEUE: "Added to queue",
};

export const ACTION_TO_CONFIRMATION_TEXT = {
  SAVE_TO_COLLECTION_PODCAST: "Added",
};

export const TERMINAL_TOOLS = new Set([
  "spotify_next",
  "spotify_previous",
  "spotify_pause",
  "spotify_volume",
  "spotify_save_track",
  "spotify_shuffle",
  "spotify_repeat",
  "spotify_add_to_queue",
  "spotify_remove_track",
  "spotify_follow",
  "spotify_unfollow",
]);

export const FAST_PLAY_TOOLS = new Set(["spotify_play"]);

export const NO_ICON_INTENTS = new Set([PLAY_INTENT]);
