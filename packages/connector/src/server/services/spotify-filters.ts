
const GLOBAL_STRIP_KEYS = [
  "available_markets",
  "preview_url",
  "disc_number",
  "copyrights",
  "audio_preview_url",
  "description",
  "html_description",
  "external_urls",
  "external_ids",
  "played_at",
  "seeds",
  "label",
  "is_local",
];

const PLAYER_STATE_STRIP_KEYS = [
  "next_tracks",
  "prev_tracks",
  "is_system_initiated",
  "queue_revision",
  "restrictions",
  "session_id",
  "signals",
  "sleep_timer",
  "suppressions",
  "index",
  "context_url",
  "page_metadata",
  "play_origin",
  "playback_id",
  "playback_quality",
  "session_command_id",
  "is_buffering",
  "format_list_type",
  "ignore_enhance_lens",
  "initiated_from_list_play_esperanto",
  "lexicon_context_url",
];

const TRACK_METADATA_STRIP_KEYS = [
  "image_large_url",
  "image_small_url",
  "image_xlarge_url",
  "album_image_large_url",
  "album_image_small_url",
  "album_image_xlarge_url",
  "entity_uri",
  "interaction_id",
  "page_instance_id",
  "iteration",
  "canonical_track_uri",
  "custom_reporting_attribution",
  "decision_id",
  "segment",
  "source-loader",
];

const TRACK_METADATA_PREFIX_STRIP = [
  "actions.",
  "audio.",
  "automix.",
  "home.card.",
  "narration.",
  "ANN_SEARCH_",
  "HAS_",
  "IN_",
  "IS_",
  "PLAYED_",
  "SKIPPED_",
];

const CONTEXT_METADATA_STRIP_KEYS = [
  "context_owner",
  "enhanced_context",
  "playlist_volatile_context_id",
  "shuffle.algorithm",
  "shuffle.distribution",
  "shuffle.partition_shuffle",
  "fetch-limit",
  "filtered-items",
  "filtering.predicate",
  "albumType",
  "albumUri",
  "artistUris",
  "copyrights",
  "courtesyLine",
  "image_url",
  "releaseDate",
];

const CONTEXT_METADATA_PREFIX_STRIP = [
  "automix.",
  "narration.",
  "genre.displayName.",
  "session_control_display.",
  "home.card.",
  "dj.interactivity.",
  "header_image_url_",
];

const CLUSTER_STRIP_KEYS = [
  "started_playing_at",
  "timestamp",
  "transfer_data_timestamp",
  "not_playing_since_timestamp",
  "need_full_player_state",
  "needs_local_devices",
  "needs_state_updates",
];

const DEVICE_STRIP_KEYS = [
  "audio_output_device_info",
  "brand",
  "client_id",
  "device_software_version",
  "metadata_map",
  "public_ip",
  "spirc_version",
];

const DEVICE_CAPABILITY_STRIP_KEYS = [
  "command_acks",
  "gaia_eq_connect_id",
  "supported_types",
  "supports_dj",
  "supports_external_episodes",
  "supports_gzip_pushes",
  "supports_hifi",
  "supports_logout",
  "supports_ping_request",
  "supports_playlist_v2",
  "supports_rename",
  "supports_set_backend_metadata",
  "supports_set_options_command",
  "supports_remote_sleep_timer",
];

function stripKeys(obj: any, keys: string[]): void {
  for (const key of keys) {
    delete obj[key];
  }
}

function stripPrefixKeys(obj: any, prefixes: string[]): void {
  for (const key of Object.keys(obj)) {
    if (prefixes.some((p) => key.startsWith(p))) {
      delete obj[key];
    }
  }
}

export function filterRecursively(obj: any): any {
  if (obj == null || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => filterRecursively(item));
  }

  stripKeys(obj, GLOBAL_STRIP_KEYS);

  const isEpisode =
    (typeof obj.uri === "string" && obj.uri.includes("spotify:episode:")) ||
    (obj.audio_preview_url !== undefined && obj.release_date !== undefined) ||
    (obj.is_playable !== undefined && obj.release_date !== undefined);
  if (!isEpisode) {
    delete obj.release_date;
    delete obj.release_date_precision;
  }

  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === "object" && obj[key] !== null) {
      obj[key] = filterRecursively(obj[key]);
    }
  }

  return obj;
}

export function cleanupWebSocketMessage(event: any): { topic: string; data: any } | null {
  if (!event || typeof event !== "object") return null;

  const hasPayloads = Array.isArray(event.payloads) && event.payloads.length > 0;
  const firstPayload = hasPayloads ? event.payloads[0] : null;
  const cluster = firstPayload?.cluster;
  const hasPlayerCluster =
    cluster && typeof cluster === "object" && (cluster.player_state || cluster.devices);

  if (hasPayloads && hasPlayerCluster) {
    const cleaned: any = { ...event };

    delete cleaned.headers;
    delete cleaned.type;
    delete cleaned.uri;

    cleaned.phone_timestamp_ms = Date.now();

    const updateReason = firstPayload?.update_reason;

    for (const payload of cleaned.payloads) {
      delete payload.update_reason;
      delete payload.devices_that_changed;
      delete payload.ack_id;

      if (payload.cluster) {
        stripKeys(payload.cluster, CLUSTER_STRIP_KEYS);

        if (payload.cluster.player_state) {
          cleanPlayerState(payload.cluster.player_state);
        }

        if (payload.cluster.devices) {
          cleanDevices(payload.cluster.devices);
        }
      }
    }

    let topic = "spotify.player.update";
    if (updateReason) {
      switch (updateReason) {
        case "DEVICE_STATE_CHANGED":
          topic = "spotify.player.device_state_changed";
          break;
        case "PLAYER_STATE_CHANGED":
          topic = "spotify.player.state_changed";
          break;
        case "DEVICE_VOLUME_CHANGED":
          topic = "spotify.player.volume_changed";
          break;
      }
    }

    return { topic, data: cleaned };
  }

  const connectionId = event?.headers?.["Spotify-Connection-Id"];
  if (typeof connectionId === "string" && connectionId.length > 0) {
    return {
      topic: "spotify.connection.established",
      data: { connection_id: connectionId },
    };
  }

  if (hasPayloads) {
    const cleaned: any = { ...event };
    delete cleaned.headers;
    delete cleaned.type;
    delete cleaned.uri;
    cleaned.phone_timestamp_ms = Date.now();

    for (const payload of cleaned.payloads) {
      delete payload.update_reason;
      delete payload.devices_that_changed;
      delete payload.ack_id;
    }

    return { topic: "spotify.message", data: cleaned };
  }

  return null;
}

function cleanPlayerState(state: any): void {
  stripKeys(state, PLAYER_STATE_STRIP_KEYS);

  if (state.options) {
    delete state.options.modes;
  }

  if (state.track?.metadata) {
    stripKeys(state.track.metadata, TRACK_METADATA_STRIP_KEYS);
    stripPrefixKeys(state.track.metadata, TRACK_METADATA_PREFIX_STRIP);

    if (typeof state.track.metadata.image_url === "string" && state.track.metadata.image_url.startsWith("spotify:image:")) {
      state.track.metadata.image_url = "i.scdn.co/image/" + state.track.metadata.image_url.slice("spotify:image:".length);
    }
  }

  if (state.context_metadata) {
    stripKeys(state.context_metadata, CONTEXT_METADATA_STRIP_KEYS);
    stripPrefixKeys(state.context_metadata, CONTEXT_METADATA_PREFIX_STRIP);
  }
}

function cleanDevices(devices: any): void {
  if (typeof devices !== "object") return;

  for (const key of Object.keys(devices)) {
    const device = devices[key];
    if (typeof device !== "object") continue;

    stripKeys(device, DEVICE_STRIP_KEYS);

    if (device.capabilities) {
      stripKeys(device.capabilities, DEVICE_CAPABILITY_STRIP_KEYS);
    }
  }
}

export function filterDeviceResponse(data: any): any {
  if (!data?.devices) return data;

  for (const device of data.devices) {
    stripKeys(device, DEVICE_STRIP_KEYS);
    if (device.capabilities) {
      stripKeys(device.capabilities, DEVICE_CAPABILITY_STRIP_KEYS);
    }
  }

  return data;
}

export function filterRecentlyPlayedResponse(data: any): any {
  if (!data?.items) return data;

  for (const item of data.items) {
    delete item.context;
    if (item.track) {
      delete item.track.popularity;
      delete item.track.track_number;
      delete item.track.duration_ms;
      delete item.track.explicit;
    }
  }

  return filterRecursively(data);
}

export function filterLyricsResponse(data: any): any {
  if (!data?.lyrics) return data;

  delete data.colors;
  delete data.hasVocalRemoval;

  const lyrics = data.lyrics;
  delete lyrics.alternatives;
  delete lyrics.capStatus;
  delete lyrics.isDenseTypeface;
  delete lyrics.isRtlLanguage;
  delete lyrics.language;
  delete lyrics.provider;
  delete lyrics.providerDisplayName;
  delete lyrics.providerLyricsId;
  delete lyrics.syncLyricsUri;
  delete lyrics.colors;
  delete lyrics.previewLines;

  if (Array.isArray(lyrics.lines)) {
    for (const line of lyrics.lines) {
      delete line.syllables;
      delete line.transliteratedWords;
    }
  }

  return data;
}
