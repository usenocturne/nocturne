import {
  SPOTIFY_CLIENT_ID,
  WEB_PLAYER_CLIENT_ID,
  SPOTIFY_SCOPES,
  SPOTIFY_USER_AGENT,
  SPOTIFY_APP_VERSION,
  SpotifyOperationHash,
} from "../config";
import { SpotifyDatabaseStorage, type SpotifyDatabaseCredentials } from "./spotify-database";
import { createLogger } from "../utils/logger";
import { base62ToHex, hexToBase62 } from "../utils/base62";

const log = createLogger("SpotifyService");

export class NotAuthenticatedError extends Error {
  constructor(message = "Not authenticated") {
    super(message);
    this.name = "NotAuthenticatedError";
  }
}

export class SpotifyAuthorizationExpiredError extends Error {
  constructor(message = "Authorization expired") {
    super(message);
    this.name = "SpotifyAuthorizationExpiredError";
  }
}

export type SpotifyAuthState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "polling"; deviceCode: string; userCode: string; verificationUri: string; interval: number }
  | { status: "linked"; displayName: string | null }
  | { status: "skipped" };

export interface SpotifyTrackInfo {
  uri: string;
  id: string;
  title: string | null;
  artistName: string | null;
  artists: { id: string; name: string; uri: string; type: string }[];
  albumTitle: string | null;
  albumUri: string | null;
  imageUrl: string | null;
  durationMs: number | null;
}

interface CachedCredentials {
  userID: string;
  accessToken: string;
  refreshToken: string;
  scope: string | null;
  tokenType: string;
  accessTokenExpiresAt: Date | null;
}

export class SpotifyService {
  private static TOKEN_REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes

  authState: SpotifyAuthState = { status: "idle" };
  private dbStorage: SpotifyDatabaseStorage;

  private cachedCredentials: CachedCredentials | null = null;
  private clientToken: string | null = null;
  private clientTokenExpiresAt: Date | null = null;
  private inFlightClientTokenPromise: Promise<string> | null = null;
  private inFlightRefreshPromise: Promise<void> | null = null;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private tokenRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private authCheckRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private authCheckAttempts = 0;
  private authStateCallbacks: ((state: SpotifyAuthState) => void)[] = [];
  private getUserID: () => string | null;

  private spclientEndpoint: string | null = null;
  private _activeDeviceId: string | null = null;
  private _spotifyUserId: string | null = null;

  constructor(
    dbStorage: SpotifyDatabaseStorage,
    getUserID: () => string | null
  ) {
    this.dbStorage = dbStorage;
    this.getUserID = getUserID;
  }

  onAuthStateChange(callback: (state: SpotifyAuthState) => void): void {
    this.authStateCallbacks.push(callback);
  }

  private setAuthState(state: SpotifyAuthState): void {
    this.authState = state;
    if (state.status === "linked") {
      this.startTokenRefreshTimer();
    } else {
      this.stopTokenRefreshTimer();
    }
    for (const cb of this.authStateCallbacks) cb(state);
  }

  private startTokenRefreshTimer(): void {
    this.stopTokenRefreshTimer();
    this.tokenRefreshTimer = setInterval(async () => {
      try {
        await this.refreshToken();
        log.info("Periodic Spotify token refresh succeeded");
      } catch (err) {
        log.warn(`Periodic Spotify token refresh failed: ${err}`);
      }
    }, SpotifyService.TOKEN_REFRESH_INTERVAL);
  }

  private stopTokenRefreshTimer(): void {
    if (this.tokenRefreshTimer) {
      clearInterval(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }
  }

  setSpclientEndpoint(endpoint: string): void {
    this.spclientEndpoint = endpoint;
  }

  setActiveDeviceId(id: string): void {
    this._activeDeviceId = id;
  }

  get activeDeviceId(): string | null {
    return this._activeDeviceId;
  }

  private async getSpotifyUserId(): Promise<string | null> {
    if (this._spotifyUserId) return this._spotifyUserId;
    try {
      const profile = await this.handleGetUserProfile();
      const uri = profile?.profile?.uri ?? profile?.uri;
      if (typeof uri === "string") {
        this._spotifyUserId = uri.split(":").pop() ?? null;
      }
      if (!this._spotifyUserId) {
        this._spotifyUserId = profile?.profile?.username ?? profile?.username ?? null;
      }
    } catch {}
    return this._spotifyUserId;
  }

  async checkAuthStatus(): Promise<void> {
    // Always cancel any pending retry; this call is the authoritative state probe.
    if (this.authCheckRetryTimer) {
      clearTimeout(this.authCheckRetryTimer);
      this.authCheckRetryTimer = null;
    }

    const userID = this.getUserID();
    if (!userID) {
      this.authCheckAttempts = 0;
      this.setAuthState({ status: "idle" });
      return;
    }

    this.authCheckAttempts++;
    try {
      const credentials = await this.dbStorage.loadCredentials(userID);
      const needsRefresh =
        !credentials.accessTokenExpiresAt ||
        credentials.accessTokenExpiresAt.getTime() < Date.now() + 300_000;

      if (needsRefresh) {
        await this.refreshToken();
      } else {
        this.cachedCredentials = {
          userID,
          accessToken: credentials.accessToken,
          refreshToken: credentials.refreshToken,
          scope: credentials.scope,
          tokenType: credentials.tokenType,
          accessTokenExpiresAt: credentials.accessTokenExpiresAt,
        };
      }

      const displayName = await this.getSpotifyDisplayName();
      this.authCheckAttempts = 0;
      this.setAuthState({ status: "linked", displayName });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (msg.includes("No credentials found")) {
        this.authCheckAttempts = 0;
        this.setAuthState({ status: "idle" });
        return;
      }
      if (
        err instanceof SpotifyAuthorizationExpiredError ||
        msg.includes("Authorization expired") ||
        msg.includes("invalid_grant")
      ) {
        this.authCheckAttempts = 0;
        log.error(`Auth definitively expired: ${msg}, clearing credentials`);
        try {
          await this.dbStorage.deleteCredentials(userID);
        } catch (delErr) {
          log.warn(`Failed to delete credentials: ${delErr}`);
        }
        this.cachedCredentials = null;
        this.setAuthState({ status: "idle" });
        return;
      }
      if (err instanceof NotAuthenticatedError) {
        this.authCheckAttempts = 0;
        log.warn("Auth check aborted: Supabase user no longer present");
        return;
      }

      const attempt = this.authCheckAttempts;
      const maxAttempts = 8;
      if (attempt >= maxAttempts) {
        log.warn(
          `Auth check failed (transient, giving up after ${attempt} attempts): ${msg}`
        );
        this.authCheckAttempts = 0;
        return;
      }
      const delayMs = Math.min(60_000, 5_000 * 2 ** Math.min(attempt - 1, 4));
      log.warn(
        `Auth check failed (transient, attempt ${attempt}/${maxAttempts}, retry in ${delayMs / 1000}s): ${msg}`
      );
      this.authCheckRetryTimer = setTimeout(() => {
        this.authCheckRetryTimer = null;
        this.checkAuthStatus().catch((e) =>
          log.error(`checkAuthStatus retry threw: ${e}`)
        );
      }, delayMs);
    }
  }

  async startDeviceAuthorization(): Promise<void> {
    this.setAuthState({ status: "loading" });

    const body = new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      scope: SPOTIFY_SCOPES,
    });

    const res = await fetch("https://accounts.spotify.com/oauth2/device/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) throw new Error(`Device auth failed: ${res.status}`);
    const data = await res.json();

    this.setAuthState({
      status: "polling",
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      interval: data.interval || 5,
    });

    this.startPolling(data.device_code, data.interval || 5);
  }

  private startPolling(deviceCode: string, interval: number): void {
    this.stopPolling();
    this.pollingInterval = setInterval(() => {
      this.pollForToken(deviceCode).catch((err) => {
        log.error(`Polling error: ${err.message}`);
      });
    }, interval * 1000);
  }

  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private async pollForToken(deviceCode: string): Promise<void> {
    const body = new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });

    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const data = await res.json();

    if (data.error === "authorization_pending") return;
    if (data.error === "slow_down") return;
    if (data.error === "expired_token") {
      this.stopPolling();
      this.setAuthState({ status: "idle" });
      return;
    }
    if (data.error) {
      this.stopPolling();
      throw new Error(data.error_description || data.error);
    }

    this.stopPolling();
    const userID = this.getUserID();
    if (!userID) throw new NotAuthenticatedError("No user ID available");

    const expiresAt = new Date(Date.now() + data.expires_in * 1000);
    this.cachedCredentials = {
      userID,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      scope: data.scope,
      tokenType: data.token_type,
      accessTokenExpiresAt: expiresAt,
    };

    await this.dbStorage.saveCredentials(
      data.access_token,
      data.refresh_token,
      data.scope,
      data.token_type,
      expiresAt,
      userID
    );

    const displayName = await this.getSpotifyDisplayName();
    this.setAuthState({ status: "linked", displayName });
  }

  cancelAuthorization(): void {
    this.stopPolling();
    this.cancelAuthCheckRetry();
    this.setAuthState({ status: "idle" });
  }

  async disconnect(): Promise<void> {
    this.stopPolling();
    this.stopTokenRefreshTimer();
    this.cancelAuthCheckRetry();
    const userID = this.getUserID();
    if (userID) {
      try {
        await this.dbStorage.deleteCredentials(userID);
      } catch (err) {
        log.warn(`Failed to delete credentials: ${err}`);
      }
    }
    this.cachedCredentials = null;
    this.setAuthState({ status: "idle" });
  }

  private cancelAuthCheckRetry(): void {
    if (this.authCheckRetryTimer) {
      clearTimeout(this.authCheckRetryTimer);
      this.authCheckRetryTimer = null;
    }
    this.authCheckAttempts = 0;
  }

  async getValidAccessToken(): Promise<string> {
    const userID = this.getUserID();
    if (!userID) throw new NotAuthenticatedError();

    if (this.cachedCredentials?.userID === userID && this.cachedCredentials.accessTokenExpiresAt) {
      const bufferMs = 5 * 60 * 1000;
      if (this.cachedCredentials.accessTokenExpiresAt.getTime() > Date.now() + bufferMs) {
        return this.cachedCredentials.accessToken;
      }
    }

    await this.refreshToken();
    if (!this.cachedCredentials) throw new Error("Failed to refresh token");
    return this.cachedCredentials.accessToken;
  }

  private async refreshToken(): Promise<void> {
    if (this.inFlightRefreshPromise) {
      await this.inFlightRefreshPromise;
      return;
    }

    this.inFlightRefreshPromise = this._doRefreshToken();
    try {
      await this.inFlightRefreshPromise;
    } finally {
      this.inFlightRefreshPromise = null;
    }
  }

  private async _doRefreshToken(): Promise<void> {
    const userID = this.getUserID();
    if (!userID) throw new NotAuthenticatedError();
    let hasRetriedInvalidGrant = false;

    while (true) {
      let refreshToken = this.cachedCredentials?.refreshToken;
      if (!refreshToken) {
        const stored = await this.dbStorage.loadCredentials(userID);
        refreshToken = stored.refreshToken;
      }

      const body = new URLSearchParams({
        client_id: SPOTIFY_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });

      const maxNetworkRetries = 10;
      let res: Response;
      for (let attempt = 0; ; attempt++) {
        try {
          res = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
          });
          break;
        } catch (err) {
          if (attempt >= maxNetworkRetries) throw err;
          const delay = Math.min(Math.pow(2, attempt), 60) * 1000;
          log.warn(`Token refresh network error (attempt ${attempt + 1}/${maxNetworkRetries}), retrying in ${delay / 1000}s: ${err}`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }

      const data = await res!.json();

      if (data.error === "invalid_grant") {
        if (!hasRetriedInvalidGrant) {
          log.warn("Got invalid_grant, clearing cache and retrying with fresh credentials from database");
          hasRetriedInvalidGrant = true;
          this.cachedCredentials = null;
          continue;
        }
        log.error("Got invalid_grant after retry - authorization truly expired");
        throw new SpotifyAuthorizationExpiredError();
      }

      if (data.error) throw new Error(data.error_description || data.error);

      const expiresAt = new Date(Date.now() + data.expires_in * 1000);
      const newRefreshToken = data.refresh_token || refreshToken;

      this.cachedCredentials = {
        userID,
        accessToken: data.access_token,
        refreshToken: newRefreshToken,
        scope: data.scope ?? this.cachedCredentials?.scope ?? null,
        tokenType: data.token_type,
        accessTokenExpiresAt: expiresAt,
      };

      await this.dbStorage.saveCredentials(
        data.access_token,
        newRefreshToken,
        this.cachedCredentials.scope,
        data.token_type,
        expiresAt,
        userID
      );

      return;
    }
  }

  private async getClientToken(): Promise<string> {
    if (this.clientToken && this.clientTokenExpiresAt && this.clientTokenExpiresAt > new Date()) {
      return this.clientToken;
    }

    if (this.inFlightClientTokenPromise) return this.inFlightClientTokenPromise;

    this.inFlightClientTokenPromise = this._fetchClientToken();
    try {
      return await this.inFlightClientTokenPromise;
    } finally {
      this.inFlightClientTokenPromise = null;
    }
  }

  private async _fetchClientToken(): Promise<string> {
    const deviceId = crypto.randomUUID().replace(/-/g, "");
    const res = await fetch("https://clienttoken.spotify.com/v1/clienttoken", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_data: {
          client_version: SPOTIFY_APP_VERSION,
          client_id: WEB_PLAYER_CLIENT_ID,
          js_sdk_data: {
            device_brand: "Apple",
            device_model: "unknown",
            os: "macos",
            os_version: "10.15.7",
            device_id: deviceId,
            device_type: "computer",
          },
        },
      }),
    });

    if (!res.ok) throw new Error("Failed to get client token");
    const data = await res.json();
    const token = data.granted_token?.token;
    const expiresAfter = data.granted_token?.expires_after_seconds ?? 3600;
    if (!token) throw new Error("No client token in response");

    this.clientToken = token;
    this.clientTokenExpiresAt = new Date(Date.now() + (expiresAfter - 60) * 1000);
    return token;
  }

  async performPathfinderRequest(operationName: string, hash: string, variables: Record<string, any>): Promise<any> {
    const accessToken = await this.getValidAccessToken();
    const clientToken = await this.getClientToken();

    const res = await fetch("https://api-partner.spotify.com/pathfinder/v2/query", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json;charset=UTF-8",
        Accept: "application/json",
        "app-platform": "WebPlayer",
        "spotify-app-version": SPOTIFY_APP_VERSION,
        "User-Agent": SPOTIFY_USER_AGENT,
        Origin: "https://open.spotify.com",
        "client-token": clientToken,
      },
      body: JSON.stringify({
        operationName,
        variables,
        extensions: { persistedQuery: { version: 1, sha256Hash: hash } },
      }),
    });

    if (res.status === 401) throw new Error("Unauthorized");
    if (!res.ok) throw new Error(`Pathfinder request failed: ${res.status}`);
    return res.json();
  }

  async sendSpClientCommand(endpoint: string, value: any, fromDeviceId: string, toDeviceId: string): Promise<any> {
    const accessToken = await this.getValidAccessToken();
    const spclient = this.spclientEndpoint || "gue1-spclient.spotify.com";

    const url = `https://${spclient}/connect-state/v1/player/command/from/${fromDeviceId}/to/${toDeviceId}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command: { endpoint, ...value } }),
    });

    if (!res.ok && res.status !== 204) {
      throw new Error(`spclient command failed: ${res.status}`);
    }
    return res.status === 204 ? {} : res.json().catch(() => ({}));
  }

  private async getSpotifyDisplayName(): Promise<string | null> {
    try {
      const result = await this.performPathfinderRequest(
        "profileAttributes",
        SpotifyOperationHash.profileAttributes,
        {}
      );
      const profile = result?.data?.me?.profile;
      return profile?.name ?? profile?.displayName ?? null;
    } catch (err: any) {
      log.warn(`Failed to fetch profile via Pathfinder: ${err.message}`);
      return null;
    }
  }

  async fetchTrackArtists(trackId: string): Promise<{ id: string; name: string; uri: string; type: string }[]> {
    const info = await this.fetchTrackInfo(trackId);
    return info?.artists ?? [];
  }

  async fetchTrackInfo(trackId: string): Promise<SpotifyTrackInfo | null> {
    try {
      const info = await this.fetchTrackInfoFromGraphQL(trackId);
      if (info && (info.title || info.artists.length > 0)) return info;
    } catch {}

    try {
      const info = await this.fetchTrackInfoFromMetadata(trackId);
      if (info) return info;
    } catch {}

    return null;
  }

  private async fetchTrackInfoFromMetadata(trackId: string): Promise<SpotifyTrackInfo | null> {
    const accessToken = await this.getValidAccessToken();
    const hexId = base62ToHex(trackId);
    const spclient = this.spclientEndpoint || "gue1-spclient.spotify.com";

    const res = await fetch(`https://${spclient}/metadata/4/track/${hexId}?market=from_token`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) throw new Error(`metadata request failed: ${res.status}`);
    const json: any = await res.json();

    const artistArray = Array.isArray(json?.artist) ? json.artist : [];
    const artists = artistArray.map((a: any) => {
      const gid = a?.gid ?? "";
      const id = gid ? hexToBase62(gid) : "";
      return {
        id,
        name: a?.name ?? "",
        uri: id ? `spotify:artist:${id}` : "",
        type: "artist",
      };
    });
    const artistName = artists.map((a: { name: string }) => a.name).filter(Boolean).join(", ") || null;

    const album = json?.album;
    const albumTitle = typeof album?.name === "string" ? album.name : null;
    const albumUri = album?.gid ? `spotify:album:${hexToBase62(album.gid)}` : null;

    let imageUrl: string | null = null;
    const images = album?.cover_group?.image;
    if (Array.isArray(images) && images.length > 0) {
      const withFileId = images.filter((img: any) => typeof img?.file_id === "string");
      const picked =
        withFileId.slice().sort((a: any, b: any) => (b?.width ?? 0) - (a?.width ?? 0))[0] ??
        withFileId[0];
      if (picked?.file_id) {
        imageUrl = `https://i.scdn.co/image/${String(picked.file_id).toLowerCase()}`;
      }
    }

    let durationMs: number | null = null;
    if (typeof json?.duration === "number") durationMs = json.duration;
    else if (typeof json?.duration === "string") {
      const parsed = parseInt(json.duration, 10);
      if (Number.isFinite(parsed) && parsed > 0) durationMs = parsed;
    }

    return {
      uri: `spotify:track:${trackId}`,
      id: trackId,
      title: typeof json?.name === "string" ? json.name : null,
      artistName,
      artists,
      albumTitle,
      albumUri,
      imageUrl,
      durationMs,
    };
  }

  private async fetchTrackInfoFromGraphQL(trackId: string): Promise<SpotifyTrackInfo | null> {
    const result = await this.performPathfinderRequest(
      "getTrack",
      SpotifyOperationHash.getTrack,
      { uri: `spotify:track:${trackId}` }
    );

    const trackUnion = result?.data?.trackUnion;
    if (!trackUnion) return null;

    const items = Array.isArray(trackUnion?.artists?.items) ? trackUnion.artists.items : [];
    const artists = items.map((a: any) => {
      const uri = typeof a?.uri === "string" ? a.uri : "";
      const parts = uri.split(":");
      const id = parts.length >= 3 ? parts[2] : "";
      return {
        id,
        name: a?.profile?.name ?? "",
        uri,
        type: "artist",
      };
    });
    const artistName = artists.map((a: { name: string }) => a.name).filter(Boolean).join(", ") || null;

    const albumOfTrack = trackUnion?.albumOfTrack;
    const albumTitle = typeof albumOfTrack?.name === "string" ? albumOfTrack.name : null;
    const albumUri = typeof albumOfTrack?.uri === "string" ? albumOfTrack.uri : null;

    let imageUrl: string | null = null;
    const sources = albumOfTrack?.coverArt?.sources;
    if (Array.isArray(sources) && sources.length > 0) {
      const withUrls = sources.filter((s: any) => typeof s?.url === "string" && s.url);
      const largest = withUrls
        .slice()
        .sort((a: any, b: any) => (b?.width ?? 0) - (a?.width ?? 0))[0];
      if (largest?.url) imageUrl = largest.url;
    }

    let durationMs: number | null = null;
    const dur = trackUnion?.duration;
    if (typeof dur?.totalMilliseconds === "number") durationMs = dur.totalMilliseconds;
    else if (typeof dur === "number") durationMs = dur;

    return {
      uri: typeof trackUnion?.uri === "string" ? trackUnion.uri : `spotify:track:${trackId}`,
      id: trackId,
      title: typeof trackUnion?.name === "string" ? trackUnion.name : null,
      artistName,
      artists,
      albumTitle,
      albumUri,
      imageUrl,
      durationMs,
    };
  }

  mergeTrackInfoIntoPlayerState(playerState: any, info: SpotifyTrackInfo): void {
    if (!playerState) return;

    const track = playerState.track;
    if (track) {
      track.metadata = track.metadata ?? {};
      const meta = track.metadata;
      if (info.title != null && !meta.title) meta.title = info.title;
      if (info.artistName != null && !meta.artist_name) meta.artist_name = info.artistName;
      if (
        info.artists.length > 0 &&
        (!Array.isArray(meta.artists) || meta.artists.length === 0)
      ) {
        meta.artists = info.artists;
      }
      if (info.albumTitle != null && !meta.album_title) meta.album_title = info.albumTitle;
      if (info.albumUri != null && !meta.album_uri) meta.album_uri = info.albumUri;
      if (info.imageUrl != null && !meta.image_url) meta.image_url = info.imageUrl;
      if (info.durationMs != null && !meta.duration) meta.duration = String(info.durationMs);
    }

    if (info.durationMs != null && !playerState.duration) {
      playerState.duration = String(info.durationMs);
    }
  }

  async handlePlay(params: any): Promise<any> {
    const contextUri = params.context_uri || params.contextUri;
    const uris = params.uris;

    if (!contextUri && !uris) {
      return this._simpleSpClientCommand("resume");
    }

    const accessToken = await this.getValidAccessToken();
    const deviceId = params.device_id || params.deviceId || this._activeDeviceId;
    if (!deviceId) throw new Error("No active device");
    const spclient = this.spclientEndpoint || "gue1-spclient.spotify.com";
    const fromId = `hobs_${crypto.randomUUID().replace(/-/g, "").substring(0, 40)}`;

    const command: any = { endpoint: "play" };
    if (contextUri) {
      command.context = { uri: contextUri, url: `context://${contextUri}` };
    }
    if (uris && !contextUri) {
      const spotifyUserId = await this.getSpotifyUserId();
      if (spotifyUserId) {
        const collectionUri = `spotify:user:${spotifyUserId}:collection`;
        command.context = { uri: collectionUri, url: `context://${collectionUri}` };
        command.options = { skip_to: { track_uri: uris[0] ?? "" } };
      } else {
        command.context = { uri: uris[0], url: `context://${uris[0]}` };
        command.options = { skip_to: { track_uri: uris[0] ?? "" } };
      }
    } else if (uris) {
      command.play_origin = { feature_identifier: "harmony" };
      command.options = { skip_to: { track_uri: uris[0] ?? "" } };
    }
    if (params.offset) {
      if (params.offset.position != null) {
        command.options = { skip_to: { track_index: params.offset.position } };
      } else if (params.offset.uri) {
        command.options = { skip_to: { track_uri: params.offset.uri } };
      }
    }

    const res = await fetch(
      `https://${spclient}/connect-state/v1/player/command/from/${fromId}/to/${deviceId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ command }),
      }
    );

    return { success: res.ok || res.status === 204 };
  }

  async handlePause(): Promise<any> {
    return this._simpleSpClientCommand("pause");
  }

  async handleNext(params?: any): Promise<any> {
    const uid = params?.uid;
    if (!uid) return this._simpleSpClientCommand("skip_next");

    const accessToken = await this.getValidAccessToken();
    const spclient = this.spclientEndpoint || "gue1-spclient.spotify.com";
    const deviceId = this._activeDeviceId;
    if (!deviceId) throw new Error("No active device");
    const fromId = `hobs_${crypto.randomUUID().replace(/-/g, "").substring(0, 40)}`;

    const metadata: any = { track_player: "audio" };
    if (params?.context_uri) {
      metadata.context_uri = params.context_uri;
      metadata.entity_uri = params.context_uri;
    }

    const res = await fetch(
      `https://${spclient}/connect-state/v1/player/command/from/${fromId}/to/${deviceId}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ command: { endpoint: "skip_next", track: { uid, provider: "context", metadata } } }),
      }
    );

    return { success: res.ok || res.status === 204 };
  }

  async handlePrevious(): Promise<any> {
    return this._simpleSpClientCommand("skip_prev");
  }

  async handleSeek(params: any): Promise<any> {
    const accessToken = await this.getValidAccessToken();
    const spclient = this.spclientEndpoint || "gue1-spclient.spotify.com";
    const deviceId = params.device_id || params.deviceId || this._activeDeviceId;
    if (!deviceId) throw new Error("No active device");
    const command = { endpoint: "seek_to", value: params.position_ms ?? params.positionMs ?? 0 };

    await fetch(
      `https://${spclient}/connect-state/v1/player/command/from/${deviceId}/to/${deviceId}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      }
    );
    return { success: true };
  }

  async handleVolume(params: any): Promise<any> {
    const accessToken = await this.getValidAccessToken();
    const spclient = this.spclientEndpoint || "gue1-spclient.spotify.com";
    const deviceId = params.device_id || params.deviceId || this._activeDeviceId;
    if (!deviceId) throw new Error("No active device");
    const volume = Math.round(((params.volume_percent ?? params.volumePercent ?? 50) / 100) * 65535);

    await fetch(
      `https://${spclient}/connect-state/v1/connect/volume/from/${deviceId}/to/${deviceId}`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ volume }),
      }
    );
    return { success: true };
  }

  async handleShuffle(params: any): Promise<any> {
    const accessToken = await this.getValidAccessToken();
    const spclient = this.spclientEndpoint || "gue1-spclient.spotify.com";
    const deviceId = params.device_id || params.deviceId || this._activeDeviceId;
    if (!deviceId) throw new Error("No active device");
    const command = { endpoint: "set_shuffling_context", value: params.state ?? false };

    await fetch(
      `https://${spclient}/connect-state/v1/player/command/from/${deviceId}/to/${deviceId}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      }
    );
    return { success: true };
  }

  async handleRepeat(params: any): Promise<any> {
    const accessToken = await this.getValidAccessToken();
    const spclient = this.spclientEndpoint || "gue1-spclient.spotify.com";
    const deviceId = params.device_id || params.deviceId || this._activeDeviceId;
    if (!deviceId) throw new Error("No active device");
    const fromId = `hobs_${crypto.randomUUID().replace(/-/g, "").substring(0, 40)}`;
    const mode = params.state ?? params.mode ?? "off";

    const sendCommand = async (endpoint: string, value: boolean) => {
      await fetch(
        `https://${spclient}/connect-state/v1/player/command/from/${fromId}/to/${deviceId}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ command: { endpoint, value } }),
        }
      );
    };

    if (mode === "track") {
      await sendCommand("set_repeating_track", true);
    } else if (mode === "context") {
      await sendCommand("set_repeating_context", true);
    } else {
      await sendCommand("set_repeating_track", false);
      await sendCommand("set_repeating_context", false);
    }

    return { success: true };
  }

  private async _simpleSpClientCommand(endpoint: string): Promise<any> {
    const accessToken = await this.getValidAccessToken();
    const spclient = this.spclientEndpoint || "gue1-spclient.spotify.com";
    const deviceId = this._activeDeviceId;
    if (!deviceId) throw new Error("No active device");
    const fromId = `hobs_${crypto.randomUUID().replace(/-/g, "").substring(0, 40)}`;

    const res = await fetch(
      `https://${spclient}/connect-state/v1/player/command/from/${fromId}/to/${deviceId}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ command: { endpoint } }),
      }
    );

    return { success: res.ok || res.status === 204 };
  }

  async handleGetPlaybackState(): Promise<any> {
    const accessToken = await this.getValidAccessToken();
    const spclient = this.spclientEndpoint || "gue1-spclient.spotify.com";
    const hobsId = `hobs_${crypto.randomUUID().replace(/-/g, "").substring(0, 40)}`;
    const connectionId = Array.from({ length: 148 }, () =>
      "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
    ).join("");

    const res = await fetch(`https://${spclient}/connect-state/v1/devices/${hobsId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Spotify-Connection-Id": connectionId,
      },
      body: JSON.stringify({
        member_type: "CONNECT_STATE",
        device: { device_info: { capabilities: { can_be_player: false, hidden: true, needs_full_player_state: true } } },
      }),
    });

    if (!res.ok) return null;
    const state = await res.json();

    if (state?.active_device_id) {
      this._activeDeviceId = state.active_device_id;
    }

    const trackUri = state?.player_state?.track?.uri;
    if (typeof trackUri === "string" && trackUri.startsWith("spotify:track:")) {
      try {
        const trackId = trackUri.slice("spotify:track:".length);
        const info = await this.fetchTrackInfo(trackId);
        if (info) {
          this.mergeTrackInfoIntoPlayerState(state.player_state, info);
        }
      } catch {}
    }

    return this.transformConnectState(state);
  }

  async handleGetDevices(): Promise<any> {
    const accessToken = await this.getValidAccessToken();
    const spclient = this.spclientEndpoint || "gue1-spclient.spotify.com";
    const hobsId = `hobs_${crypto.randomUUID().replace(/-/g, "").substring(0, 40)}`;
    const connectionId = Array.from({ length: 148 }, () =>
      "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
    ).join("");

    const res = await fetch(`https://${spclient}/connect-state/v1/devices/${hobsId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Spotify-Connection-Id": connectionId,
      },
      body: JSON.stringify({
        member_type: "CONNECT_STATE",
        device: { device_info: { capabilities: { can_be_player: false, hidden: true, needs_full_player_state: true } } },
      }),
    });

    if (!res.ok) return { devices: {} };
    const state = await res.json();
    const activeDeviceId = state?.active_device_id;
    const rawDevices = state?.devices ?? {};
    const devices: any = {};

    for (const [id, d] of Object.entries(rawDevices) as [string, any][]) {
      const device: any = { ...d };
      delete device.audio_output_device_info;
      delete device.device_software_version;
      delete device.metadata_map;
      delete device.public_ip;
      delete device.spirc_version;
      delete device.brand;
      delete device.client_id;
      if (device.capabilities) {
        delete device.capabilities.command_acks;
        delete device.capabilities.gaia_eq_connect_id;
        delete device.capabilities.supports_dj;
        delete device.capabilities.supports_external_episodes;
        delete device.capabilities.supports_gzip_pushes;
        delete device.capabilities.supports_hifi;
        delete device.capabilities.supports_logout;
        delete device.capabilities.supports_ping_request;
        delete device.capabilities.supports_playlist_v2;
        delete device.capabilities.supports_rename;
        delete device.capabilities.supports_set_backend_metadata;
        delete device.capabilities.supports_set_options_command;
        delete device.capabilities.supported_types;
      }
      devices[id] = device;
    }

    if (activeDeviceId) this._activeDeviceId = activeDeviceId;
    const result: any = { devices };
    if (activeDeviceId) result.active_device_id = activeDeviceId;
    return result;
  }

  async handleTransferPlayback(params: any): Promise<any> {
    const accessToken = await this.getValidAccessToken();
    const spclient = this.spclientEndpoint || "gue1-spclient.spotify.com";
    const deviceIds = (params.deviceIds || params.device_ids || []).filter(Boolean);
    const targetId = deviceIds[0] || this._activeDeviceId;
    if (!targetId) throw new Error("No target device");

    const res = await fetch(
      `https://${spclient}/connect-state/v1/connect/transfer/from/_/to/${targetId}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ transfer_options: { restore_paused: params.play ? "restore" : "keep" } }),
      }
    );
    return { success: res.ok || res.status === 204 };
  }

  async handleGetUserPlaylists(params?: any): Promise<any> {
    const offset = params?.offset ?? 0;
    const limit = params?.limit ?? 50;
    const result = await this.performPathfinderRequest("libraryV3", SpotifyOperationHash.libraryV3, {
      filters: ["Playlists"],
      order: null,
      textFilter: "",
      features: ["LIKED_SONGS", "YOUR_EPISODES_V2", "PRERELEASES", "EVENTS"],
      limit, offset,
      flatten: true,
      expandedFolders: [],
      folderUri: null,
      includeFoldersWhenFlattening: false,
    });
    const lib = result?.data?.me?.libraryV3;
    if (!lib?.items) return { items: [], total: 0, offset, limit };
    const rawItems = lib.items;
    const playlists = rawItems.map((entry: any) => {
      const data = entry.item?.data;
      if (!data) return null;
      const typename = data.__typename;
      if (typename !== "Playlist" && typename !== "PseudoPlaylist") return null;
      const uri = data.uri ?? entry.item?._uri ?? "";
      const id = uri.split(":").pop() ?? "";
      const playlist: any = { uri, id, name: data.name ?? "" };

      if (data.__typename === "PseudoPlaylist") {
        playlist.tracks = { total: data.count ?? 0 };
      }

      if (data.ownerV2?.data) {
        const o = data.ownerV2.data;
        playlist.owner = { display_name: o.name, id: o.id ?? o.uri?.split(":").pop() ?? "", uri: o.uri };
      }

      if (data.images?.items) {
        playlist.images = data.images.items
          .map((img: any) => {
            const src = img.sources?.find((s: any) => s.height === 300) ?? img.sources?.[0];
            return src ? { url: src.url, height: src.height ?? 0, width: src.width ?? 0 } : null;
          })
          .filter(Boolean);
      }

      return playlist;
    }).filter(Boolean);

    for (const playlist of playlists) {
      if (playlist.tracks) continue;
      try {
        const count = await this.fetchPlaylistTrackCount(playlist.id);
        playlist.tracks = { total: count };
      } catch {}
    }

    const filteredOut = rawItems.length - playlists.length;
    const adjustedTotal = Math.max((lib.totalCount ?? playlists.length) - filteredOut, playlists.length);
    return { items: playlists, total: adjustedTotal, offset, limit };
  }

  private async fetchPlaylistTrackCount(playlistId: string): Promise<number> {
    const result = await this.performPathfinderRequest("fetchPlaylist", SpotifyOperationHash.fetchPlaylist, {
      uri: `spotify:playlist:${playlistId}`,
      offset: 0,
      limit: 0,
      enableWatchFeedEntrypoint: false,
    });
    return result?.data?.playlistV2?.content?.totalCount ?? 0;
  }

  async handleGetSavedTracks(params?: any): Promise<any> {
    const offset = params?.offset ?? 0;
    const limit = params?.limit ?? 50;
    const result = await this.performPathfinderRequest("fetchLibraryTracks", SpotifyOperationHash.fetchLibraryTracks, {
      offset, limit,
    });
    const tracks = result?.data?.me?.library?.tracks;
    if (!tracks) return { items: [], total: 0, offset, limit };
    const items = (tracks.items ?? [])
      .map((item: any) => {
        const trackData = item.track?.data;
        if (!trackData) return null;
        const track = this.transformTrackResponse(trackData);
        if (!track.uri && item.track?._uri) {
          track.uri = item.track._uri;
          track.id = item.track._uri.split(":").pop() ?? "";
        }
        if (params?.mockingbird) {
          if (track.album) {
            const slim: any = {};
            if (track.album.name) slim.name = track.album.name;
            if (track.album.uri) slim.uri = track.album.uri;
            const small = track.album.images?.find((s: any) => s.height === 64);
            if (small?.url) slim.image_url = small.url;
            track.album = slim;
          }
        } else {
          delete track.album;
        }
        return { track };
      })
      .filter(Boolean);
    return this.filterResponse({ items, total: tracks.totalCount ?? items.length, offset, limit });
  }

  async handleGetSavedShows(params?: any): Promise<any> {
    const offset = params?.offset ?? 0;
    const limit = params?.limit ?? 50;
    const result = await this.performPathfinderRequest("libraryV3", SpotifyOperationHash.libraryV3, {
      filters: ["Podcasts & Shows"],
      order: null,
      textFilter: "",
      features: ["LIKED_SONGS", "YOUR_EPISODES_V2", "PRERELEASES", "EVENTS"],
      limit, offset,
      flatten: false,
      expandedFolders: [],
      folderUri: null,
      includeFoldersWhenFlattening: true,
    });
    const lib = result?.data?.me?.libraryV3;
    if (!lib?.items) return { items: [], total: 0, offset, limit };
    const items = lib.items.map((entry: any) => {
      const data = entry.item?.data;
      if (!data) return null;
      const typename = data.__typename;
      if (typename !== "Podcast" && typename !== "PodcastShow") return null;
      const uri = data.uri ?? entry.item?._uri ?? "";
      const show: any = {
        uri,
        id: uri.split(":").pop() ?? "",
        name: data.name ?? "",
        publisher: data.publisher?.name ?? "",
        media_type: data.mediaType ?? "",
        description: data.description ?? "",
        explicit: data.isExplicit ?? false,
      };
      if (data.coverArt?.sources) {
        show.images = data.coverArt.sources.map((s: any) => ({ url: s.url, height: s.height, width: s.width }));
      }
      if (data.episodesV2?.totalCount != null) show.total_episodes = data.episodesV2.totalCount;
      return {
        added_at: entry.addedAt?.isoString,
        show,
      };
    }).filter(Boolean);
    return { items, total: lib.totalCount ?? items.length, offset, limit };
  }

  async handleSaveTracks(params: any): Promise<any> {
    const uris = (params.track_ids || params.ids || params.uris || []).map((id: string) =>
      id.startsWith("spotify:") ? id : `spotify:track:${id}`
    );
    await this.performPathfinderRequest("addToLibrary", SpotifyOperationHash.addToLibrary, { libraryItemUris: uris });
    return { success: true };
  }

  async handleRemoveTracks(params: any): Promise<any> {
    const uris = (params.track_ids || params.ids || params.uris || []).map((id: string) =>
      id.startsWith("spotify:") ? id : `spotify:track:${id}`
    );
    await this.performPathfinderRequest("removeFromLibrary", SpotifyOperationHash.removeFromLibrary, { libraryItemUris: uris });
    return { success: true };
  }

  async handleCheckSavedTracks(params: any): Promise<any> {
    const ids = params.track_ids || params.ids || params.uris || [];
    const uris = ids.map((id: string) =>
      id.startsWith("spotify:") ? id : `spotify:track:${id}`
    );
    const result = await this.performPathfinderRequest("areEntitiesInLibrary", SpotifyOperationHash.areEntitiesInLibrary, { uris });
    const lookup = result?.data?.lookup;
    if (!Array.isArray(lookup)) return ids.map(() => false);
    return lookup.map((item: any) => item?.data?.saved ?? item?.saved ?? false);
  }

  async handleSaveShows(params: any): Promise<any> {
    const uris = (params.show_ids || params.ids || params.uris || []).map((id: string) =>
      id.startsWith("spotify:") ? id : `spotify:show:${id}`
    );
    await this.performPathfinderRequest("addToLibrary", SpotifyOperationHash.addToLibrary, { libraryItemUris: uris });
    return { success: true };
  }

  async handleRemoveShows(params: any): Promise<any> {
    const uris = (params.show_ids || params.ids || params.uris || []).map((id: string) =>
      id.startsWith("spotify:") ? id : `spotify:show:${id}`
    );
    await this.performPathfinderRequest("removeFromLibrary", SpotifyOperationHash.removeFromLibrary, { libraryItemUris: uris });
    return { success: true };
  }

  async handleCheckSavedShows(params: any): Promise<any> {
    const ids = params.show_ids || params.ids || params.uris || [];
    const uris = ids.map((id: string) =>
      id.startsWith("spotify:") ? id : `spotify:show:${id}`
    );
    const result = await this.performPathfinderRequest("areEntitiesInLibrary", SpotifyOperationHash.areEntitiesInLibrary, { uris });
    const lookup = result?.data?.lookup;
    if (!Array.isArray(lookup)) return ids.map(() => false);
    return lookup.map((item: any) => item?.data?.saved ?? item?.saved ?? false);
  }

  async handleGetArtist(params: any): Promise<any> {
    const id = params.content_id || params.contentId || params.id;
    const uri = id.startsWith("spotify:") ? id : `spotify:artist:${id}`;
    const result = await this.performPathfinderRequest("queryArtistOverview", SpotifyOperationHash.queryArtistOverview, {
      uri,
      locale: "",
      includePrerelease: true,
    });
    const artist = result?.data?.artistUnion;
    if (!artist) return result;
    return this.transformArtistResponse(artist);
  }

  private transformArtistResponse(artist: any): any {
    const result: any = {};
    result.uri = artist.uri;
    result.id = artist.id ?? artist.uri?.split(":").pop() ?? "";
    result.name = artist.profile?.name ?? "";
    result.type = "artist";
    result.verified = artist.profile?.verified ?? false;

    if (artist.visuals?.avatarImage?.sources) {
      result.images = artist.visuals.avatarImage.sources.map((s: any) => ({
        url: s.url, height: s.height, width: s.width,
      }));
    }

    if (artist.stats) {
      result.followers = { total: artist.stats.followers ?? 0 };
      result.monthly_listeners = artist.stats.monthlyListeners ?? 0;
    }

    if (artist.profile?.biography?.text) {
      result.biography = artist.profile.biography.text;
    }

    if (artist.discography?.topTracks?.items) {
      result.top_tracks = artist.discography.topTracks.items.map((item: any) => {
        return this.transformTrackResponse(item.track ?? item);
      });
    }

    const transformReleases = (items: any[]) =>
      items.map((item: any) => {
        const release = item.releases?.items?.[0] ?? item;
        const rUri = release.uri ?? "";
        return {
          id: release.id ?? rUri.split(":").pop() ?? "",
          name: release.name,
          uri: rUri,
          type: (release.type ?? "ALBUM").toLowerCase(),
          total_tracks: release.tracks?.totalCount,
          release_date: release.date ? `${release.date.year}-${String(release.date.month ?? 1).padStart(2, "0")}-${String(release.date.day ?? 1).padStart(2, "0")}` : undefined,
          images: release.coverArt?.sources?.map((s: any) => ({ url: s.url, height: s.height, width: s.width })) ?? [],
        };
      });

    if (artist.discography?.albums?.items) {
      result.albums = transformReleases(artist.discography.albums.items);
    }
    if (artist.discography?.singles?.items) {
      result.singles = transformReleases(artist.discography.singles.items);
    }
    if (artist.discography?.popularReleasesAlbums?.items) {
      result.popular_releases = transformReleases(artist.discography.popularReleasesAlbums.items);
    }

    if (artist.relatedContent?.relatedArtists?.items) {
      result.related_artists = artist.relatedContent.relatedArtists.items.map((a: any) => ({
        id: a.id ?? a.uri?.split(":").pop() ?? "",
        name: a.profile?.name ?? "",
        uri: a.uri ?? "",
        images: a.visuals?.avatarImage?.sources?.map((s: any) => ({ url: s.url, height: s.height, width: s.width })) ?? [],
      }));
    }

    return result;
  }

  async handleGetArtistTopTracks(params: any): Promise<any> {
    const id = params.content_id || params.contentId || params.id;
    const uri = id.startsWith("spotify:") ? id : `spotify:artist:${id}`;
    const result = await this.performPathfinderRequest("queryArtistOverview", SpotifyOperationHash.queryArtistOverview, {
      uri,
      locale: "",
      includePrerelease: true,
    });
    const artist = result?.data?.artistUnion;
    const discography = artist?.discography;
    const topTracks = discography?.topTracks;
    if (!topTracks?.items) return { tracks: [] };

    let albumLookup: Record<string, any> | null = null;
    if (params.mockingbird) {
      albumLookup = this.buildAlbumLookup(discography);
    }

    const tracks = topTracks.items.map((item: any) => {
      const trackData = item.track ?? item;
      const transformed = this.transformTrackResponse(trackData);
      if (params.mockingbird) {
        const albumOfTrack = trackData.albumOfTrack;
        const albumUri = albumOfTrack?.uri;
        if (albumUri && albumLookup?.[albumUri]?.image_url) {
          transformed.album = albumLookup[albumUri];
        } else if (albumOfTrack) {
          transformed.album = this.buildMinimalAlbumInfo(albumOfTrack);
        } else {
          delete transformed.album;
        }
      } else {
        delete transformed.album;
      }
      return transformed;
    });
    return this.filterResponse({ tracks });
  }

  private buildMinimalAlbumInfo(albumOfTrack: any): any {
    const info: any = {
      name: albumOfTrack?.name ?? "",
      uri: albumOfTrack?.uri ?? "",
    };
    const sources = albumOfTrack?.coverArt?.sources;
    if (Array.isArray(sources) && sources.length > 0) {
      const preferred =
        sources.find((s: any) => s?.height === 64) ??
        sources
          .slice()
          .sort(
            (a: any, b: any) =>
              (a?.height ?? Number.MAX_SAFE_INTEGER) -
              (b?.height ?? Number.MAX_SAFE_INTEGER),
          )[0];
      if (preferred?.url) info.image_url = preferred.url;
    }
    return info;
  }

  private buildAlbumLookup(discography: any): Record<string, any> {
    const lookup: Record<string, any> = {};
    const popular = discography?.popularReleasesAlbums;
    if (popular?.items) {
      for (const album of popular.items) {
        if (album.uri) {
          const info: any = { name: album.name ?? "", uri: album.uri };
          const small = album.coverArt?.sources?.find((s: any) => s.height === 64);
          if (small?.url) info.image_url = small.url;
          lookup[album.uri] = info;
        }
      }
    }
    for (const key of ["albums", "singles"]) {
      const section = discography?.[key];
      if (!section?.items) continue;
      for (const item of section.items) {
        const releases = item.releases?.items;
        if (!Array.isArray(releases)) continue;
        for (const release of releases) {
          if (release.uri && !lookup[release.uri]) {
            const info: any = { name: release.name ?? "", uri: release.uri };
            const small = release.coverArt?.sources?.find((s: any) => s.height === 64);
            if (small?.url) info.image_url = small.url;
            lookup[release.uri] = info;
          }
        }
      }
    }
    return lookup;
  }

  async handleGetAlbum(params: any): Promise<any> {
    const id = params.content_id || params.contentId || params.id;
    const uri = id.startsWith("spotify:") ? id : `spotify:album:${id}`;
    const result = await this.performPathfinderRequest("getAlbum", SpotifyOperationHash.getAlbum, {
      uri,
      locale: "",
      offset: params.offset ?? 0,
      limit: params.limit ?? 50,
    });
    const album = result?.data?.albumUnion ?? result;
    return this.filterResponse(this.transformAlbumResponse(album));
  }

  private transformAlbumResponse(album: any): any {
    if (!album || typeof album !== "object") return album;

    const result: any = {};
    if (album.uri) {
      result.uri = album.uri;
      result.id = album.uri.split(":").pop() ?? "";
    }
    result.name = album.name;
    result.album_type = (album.type ?? "album").toLowerCase();

    if (album.artists?.items) {
      result.artists = this.flattenArtists(album.artists.items);
    }

    if (album.coverArt?.sources) {
      result.images = album.coverArt.sources
        .filter((s: any) => s.height === 300)
        .map((s: any) => ({ url: s.url, height: s.height, width: s.width }));
      if (result.images.length === 0) {
        result.images = album.coverArt.sources.map((s: any) => ({ url: s.url, height: s.height, width: s.width }));
      }
    }

    const tracks = album.tracksV2 ?? album.tracks;
    if (tracks) {
      result.total_tracks = tracks.totalCount;
      result.tracks = tracks;
    }

    if (album.date?.isoString) result.release_date = album.date.isoString;

    return result;
  }

  private flattenArtists(items: any[]): any[] {
    if (!Array.isArray(items)) return [];
    return items.map((a: any) => {
      const uri = a.uri ?? "";
      return {
        id: uri.split(":").pop() ?? "",
        name: a.profile?.name ?? a.name ?? "",
        uri,
      };
    });
  }

  private transformTrackResponse(track: any): any {
    if (!track || typeof track !== "object") return track;
    const result: any = {};
    if (track.uri) {
      result.uri = track.uri;
      result.id = track.uri.split(":").pop() ?? "";
    }
    result.name = track.name;
    result.track_number = track.trackNumber;
    result.disc_number = track.discNumber ?? 1;
    result.explicit = track.contentRating?.label === "EXPLICIT";

    const dur = track.trackDuration ?? track.duration;
    if (dur?.totalMilliseconds != null) result.duration_ms = dur.totalMilliseconds;

    const artistsData = track.artists ?? track.firstArtist;
    if (artistsData?.items) {
      result.artists = this.flattenArtists(artistsData.items);
    }

    if (track.albumOfTrack) {
      const ad = track.albumOfTrack;
      const albumResult: any = {};
      if (ad.uri) { albumResult.uri = ad.uri; albumResult.id = ad.uri.split(":").pop() ?? ""; }
      albumResult.name = ad.name;
      if (ad.coverArt?.sources) {
        albumResult.images = ad.coverArt.sources.map((s: any) => ({ url: s.url, height: s.height, width: s.width }));
      }
      result.album = albumResult;
    }

    if (track.playability) result.is_playable = track.playability.playable;
    return result;
  }

  private transformPlaylistResponse(playlist: any): any {
    if (!playlist || typeof playlist !== "object") return playlist;
    const result: any = {};
    if (playlist.uri) { result.uri = playlist.uri; result.id = playlist.uri.split(":").pop() ?? ""; }
    result.name = playlist.name;
    result.description = playlist.description;
    result.collaborative = playlist.collaborative ?? false;
    result.public = playlist.public;

    if (playlist.ownerV2?.data) {
      const o = playlist.ownerV2.data;
      result.owner = { display_name: o.name, uri: o.uri, id: o.uri?.split(":").pop() ?? "" };
    }

    if (playlist.images?.items) {
      result.images = playlist.images.items
        .map((item: any) => item.sources?.[0])
        .filter(Boolean)
        .map((s: any) => ({ url: s.url, height: s.height ?? 0, width: s.width ?? 0 }));
    }

    if (playlist.content) {
      const tracks: any = { total: playlist.content.totalCount };
      if (playlist.content.items) {
        tracks.items = playlist.content.items
          .map((item: any) => {
            const trackData = item.itemV2?.data;
            if (!trackData) return null;
            return {
              added_at: item.addedAt?.isoString,
              track: this.transformTrackResponse(trackData),
            };
          })
          .filter(Boolean);
      }
      result.tracks = tracks;
    }

    if (playlist.followers != null) result.followers = { total: playlist.followers };
    return result;
  }

  private transformTopArtistResponse(artist: any): any {
    const result: any = {};
    if (artist.uri) { result.uri = artist.uri; result.id = artist.uri.split(":").pop() ?? ""; }
    if (artist.profile) result.name = artist.profile.name;
    else result.name = artist.name;
    if (artist.visuals?.avatarImage?.sources) {
      const filtered = artist.visuals.avatarImage.sources.filter((s: any) => s.height === 320);
      result.images = (filtered.length > 0 ? filtered : artist.visuals.avatarImage.sources)
        .map((s: any) => ({ url: s.url, height: s.height, width: s.width }));
    }
    result.type = "artist";
    return result;
  }

  async handleGetAlbumTracks(params: any): Promise<any> {
    const id = params.albumId || params.album_id || params.id;
    const uri = id.startsWith("spotify:") ? id : `spotify:album:${id}`;
    const offset = params.offset ?? 0;
    const limit = params.limit ?? 50;
    const result = await this.performPathfinderRequest("getAlbum", SpotifyOperationHash.getAlbum, {
      uri, locale: "", offset, limit,
    });
    const album = result?.data?.albumUnion;
    const tracksData = album?.tracksV2 ?? album?.tracks;
    if (!tracksData) return { items: [], total: 0, offset, limit };
    const items = (tracksData.items ?? []).map((item: any) => {
      const track = item.track ?? item;
      return this.transformTrackResponse(track);
    });
    return this.filterResponse({ items, total: tracksData.totalCount ?? items.length, offset, limit });
  }

  async handleGetPlaylist(params: any): Promise<any> {
    const id = params.content_id || params.contentId || params.id;
    const uri = id.startsWith("spotify:") ? id : `spotify:playlist:${id}`;
    const fields = params.fields;
    const result = await this.performPathfinderRequest("fetchPlaylist", SpotifyOperationHash.fetchPlaylist, {
      uri, offset: 0, limit: params.limit ?? 50, enableWatchFeedEntrypoint: true,
    });
    const playlist = result?.data?.playlistV2;
    if (!playlist) return result;
    const full = this.filterResponse(this.transformPlaylistResponse(playlist));
    if (fields && typeof fields === "string") {
      return this.filterByFields(full, fields);
    }
    return full;
  }

  private filterByFields(obj: any, fields: string): any {
    const result: any = {};
    for (const field of fields.split(",")) {
      const parts = field.trim().split(".");
      let src = obj;
      let dst = result;
      for (let i = 0; i < parts.length; i++) {
        const key = parts[i];
        if (src == null || typeof src !== "object") break;
        if (i === parts.length - 1) {
          dst[key] = src[key];
        } else {
          if (dst[key] == null) dst[key] = {};
          dst = dst[key];
          src = src[key];
        }
      }
    }
    return result;
  }

  async handleGetPlaylistTracks(params: any): Promise<any> {
    const id = params.playlistId || params.playlist_id || params.id;
    const uri = id.startsWith("spotify:") ? id : `spotify:playlist:${id}`;
    const offset = params.offset ?? 0;
    const limit = params.limit ?? 50;
    const result = await this.performPathfinderRequest("fetchPlaylist", SpotifyOperationHash.fetchPlaylist, {
      uri, offset, limit, enableWatchFeedEntrypoint: true,
    });
    const content = result?.data?.playlistV2?.content;
    if (!content) return { items: [], total: 0, offset, limit };
    const items = (content.items ?? [])
      .map((item: any) => {
        const trackData = item.itemV2?.data;
        if (!trackData) return null;
        const track = this.transformTrackResponse(trackData);
        if (params.mockingbird) {
          if (track.album) {
            const slim: any = {};
            if (track.album.name) slim.name = track.album.name;
            if (track.album.uri) slim.uri = track.album.uri;
            const small = track.album.images?.find((s: any) => s.height === 64);
            if (small?.url) slim.image_url = small.url;
            track.album = slim;
          }
        } else {
          delete track.album?.images;
        }
        return { track };
      })
      .filter(Boolean);
    return this.filterResponse({ items, total: content.totalCount ?? items.length, offset, limit });
  }

  async handleGetShow(params: any): Promise<any> {
    const id = params.content_id || params.contentId || params.id;
    const uri = id.startsWith("spotify:") ? id : `spotify:show:${id}`;
    const result = await this.performPathfinderRequest("queryShowMetadataV2", SpotifyOperationHash.queryShowMetadataV2, {
      uri,
    });
    const show = result?.data?.podcastUnionV2;
    if (!show) return result;
    return this.transformShowResponse(show);
  }

  private transformShowResponse(show: any): any {
    const result: any = {};
    if (show.uri) { result.uri = show.uri; result.id = show.id ?? show.uri.split(":").pop() ?? ""; }
    result.name = show.name ?? "";
    result.publisher = show.publisher?.name ?? show.publisher ?? "";
    result.description = show.htmlDescription ?? show.description ?? "";
    result.media_type = show.mediaType ?? "";
    result.explicit = show.contentRatingV2?.label === "EXPLICIT" || false;
    result.saved = show.saved ?? false;

    if (show.coverArt?.sources) {
      result.images = show.coverArt.sources.map((s: any) => ({ url: s.url, height: s.height, width: s.width }));
    }

    if (show.episodesV2) {
      result.total_episodes = show.episodesV2.totalCount ?? show.episodesV2.items?.length ?? 0;
    }

    return result;
  }

  private transformEpisodeResponse(ep: any): any {
    const result: any = {};
    if (ep.uri) { result.uri = ep.uri; result.id = ep.id ?? ep.uri.split(":").pop() ?? ""; }
    result.name = ep.name ?? "";
    result.description = ep.htmlDescription ?? ep.description ?? "";

    if (ep.duration?.totalMilliseconds != null) {
      result.duration_ms = ep.duration.totalMilliseconds;
    }
    if (ep.releaseDate?.isoString) {
      result.release_date = ep.releaseDate.isoString;
    }
    if (ep.coverArt?.sources) {
      result.images = ep.coverArt.sources.map((s: any) => ({ url: s.url, height: s.height, width: s.width }));
    }
    if (ep.playedState) {
      result.resume_point = {
        fully_played: ep.playedState.state === "COMPLETED",
        resume_position_ms: ep.playedState.playPositionMilliseconds ?? 0,
      };
    }
    if (ep.podcastV2?.data) {
      result.show = {
        name: ep.podcastV2.data.name,
        uri: ep.podcastV2.data.uri,
        id: ep.podcastV2.data.uri?.split(":").pop() ?? "",
      };
    }

    return result;
  }

  async handleGetShowEpisodes(params: any, paginationParams?: any): Promise<any> {
    const id = params.content_id || params.contentId || params.id;
    const uri = id.startsWith("spotify:") ? id : `spotify:show:${id}`;
    const offset = paginationParams?.offset ?? params.offset ?? 0;
    const limit = paginationParams?.limit ?? params.limit ?? 50;
    const result = await this.performPathfinderRequest("queryPodcastEpisodes", SpotifyOperationHash.queryPodcastEpisodes, {
      uri, offset, limit,
    });
    const episodes = result?.data?.podcastUnionV2?.episodesV2;
    if (!episodes?.items) return { items: [], total: 0, offset, limit };
    const items = episodes.items.map((item: any) => {
      const ep = item.entity?.data ?? item.data ?? item;
      return this.transformEpisodeResponse(ep);
    }).filter((e: any) => e.uri);
    return { items, total: episodes.totalCount ?? items.length, offset, limit };
  }

  async handleGetUserProfile(): Promise<any> {
    const result = await this.performPathfinderRequest("profileAttributes", SpotifyOperationHash.profileAttributes, {});
    return result?.data?.me ?? result;
  }

  async handleGetTopArtists(params?: any): Promise<any> {
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;
    const result = await this.performPathfinderRequest("userTopContent", SpotifyOperationHash.userTopContent, {
      includeTopArtists: true,
      includeTopTracks: false,
      topArtistsInput: { offset, limit, sortBy: "AFFINITY" },
      topTracksInput: { offset: 0, limit: 1, sortBy: "AFFINITY" },
    });
    const topArtists = result?.data?.me?.profile?.topArtists ?? result?.data?.me?.topContent;
    if (!topArtists?.items) return { items: [], total: 0, offset, limit };
    const items = topArtists.items.map((item: any) => {
      const data = item.data ?? item;
      return this.transformTopArtistResponse(data);
    });
    return this.filterResponse({ items, total: topArtists.totalCount ?? items.length, offset, limit });
  }

  async handleGetTopTracks(params?: any): Promise<any> {
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;
    const result = await this.performPathfinderRequest("userTopContent", SpotifyOperationHash.userTopContent, {
      includeTopArtists: false,
      includeTopTracks: true,
      topArtistsInput: { offset: 0, limit: 1, sortBy: "AFFINITY" },
      topTracksInput: { offset, limit, sortBy: "AFFINITY" },
    });
    return this.filterResponse(result?.data?.me?.profile?.topTracks ?? result?.data?.me?.topContent ?? result);
  }

  async handleGetRecentlyPlayed(params?: any): Promise<any> {
    const accessToken = await this.getValidAccessToken();
    const userId = await this.getSpotifyUserId();
    if (!userId) return { albums: [] };

    const limit = params?.limit ?? 50;
    const res = await fetch(
      `https://spclient.wg.spotify.com/recently-played/v3/user/${userId}/recently-played?format=json&offset=0&limit=${limit}&market=from_token`,
      { headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return { albums: [] };
    const json = await res.json();

    const playContexts: any[] = json?.playContexts ?? [];
    const trackUris = playContexts
      .map((ctx: any) => ctx.lastPlayedTrackUri)
      .filter((uri: any) => typeof uri === "string" && uri.startsWith("spotify:track:"));

    const seenAlbumUris = new Set<string>();
    const albums: any[] = [];
    for (const trackUri of trackUris) {
      if (albums.length >= limit) break;
      try {
        const track = await this.fetchTrackDetails(trackUri);
        const trackAlbum = track?.album;
        if (!trackAlbum?.uri) continue;
        if (seenAlbumUris.has(trackAlbum.uri)) continue;
        seenAlbumUris.add(trackAlbum.uri);

        const album: any = {
          uri: trackAlbum.uri,
          id: trackAlbum.id ?? trackAlbum.uri.split(":").pop() ?? "",
          name: trackAlbum.name ?? "",
        };

        if (trackAlbum.images) {
          album.images = trackAlbum.images.filter((s: any) => s.height === 300);
        }

        try {
          album.artists = await this.fetchAlbumArtists(album.id);
        } catch {}

        albums.push(album);
      } catch {
        log.warn(`Failed to fetch track details for ${trackUri}`);
      }
    }

    return { albums };
  }

  private async fetchAlbumArtists(albumId: string): Promise<any[]> {
    const result = await this.performPathfinderRequest("getAlbum", SpotifyOperationHash.getAlbum, {
      uri: `spotify:album:${albumId}`,
      locale: "",
      offset: 0,
      limit: 1,
    });
    const artistItems = result?.data?.albumUnion?.artists?.items;
    if (!Array.isArray(artistItems)) return [];
    return artistItems.map((a: any) => {
      const uri = a.uri ?? "";
      return {
        id: uri.split(":").pop() ?? "",
        name: a.profile?.name ?? "",
        uri,
        type: "artist",
      };
    });
  }

  async handleGetRadioMixes(): Promise<any> {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const result = await this.performPathfinderRequest("homeSection", SpotifyOperationHash.homeSection, {
      uri: "spotify:section:0JQ5DAUnp4wcj0bCb3wh3S",
      timeZone: tz,
      sp_t: "",
      sectionItemsOffset: 0,
      sectionItemsLimit: 20,
    });
    const sections = result?.data?.homeSections?.sections;
    if (!Array.isArray(sections)) return { sections: [] };
    const transformed = sections.map((section: any) => {
      const title = section.data?.title?.transformedLabel ?? "";
      const sectionItems = section.sectionItems?.items ?? [];
      const items = sectionItems.map((item: any) => {
        const content = item.content?.data;
        if (!content) return null;
        let image_url: string | null = null;
        const firstImage = content.images?.items?.[0];
        if (firstImage?.sources?.[0]?.url) image_url = firstImage.sources[0].url;
        return { uri: item.uri, name: content.name, format: content.format, image_url };
      }).filter(Boolean);
      return { title, items };
    });
    return { sections: transformed };
  }

  async handleGetRadioPlaylist(params: any): Promise<any> {
    const id = params.content_id || params.contentId || params.id;
    return this.handleGetPlaylist({ id });
  }

  async handleGetRadioTopMix(): Promise<any> {
    const topTracks = await this.handleGetTopTracks({ limit: 10 });
    const items = topTracks?.items;
    if (!Array.isArray(items) || items.length === 0) return { tracks: [], total: 0 };
    const seed = items[Math.floor(Math.random() * items.length)];
    const seedId = seed.id ?? seed.uri?.split(":").pop();
    if (!seedId) return { tracks: [], total: 0 };
    const result = await this.performPathfinderRequest(
      "internalLinkRecommenderTrack", SpotifyOperationHash.internalLinkRecommenderTrack,
      { uri: `spotify:track:${seedId}`, limit: 50 }
    );
    const recItems = result?.data?.seoRecommendedTrack?.items ?? [];
    const tracks = recItems.map((item: any) => {
      const t = this.transformTrackResponse(item.data ?? item);
      delete t.album;
      return t;
    }).filter((t: any) => t.uri);
    return this.filterResponse({ tracks, total: tracks.length });
  }

  async handleGetRadioDiscoveries(): Promise<any> {
    const topArtists = await this.handleGetTopArtists({ limit: 10 });
    const artistItems = topArtists?.items;
    if (!Array.isArray(artistItems) || artistItems.length === 0) return { tracks: [], total: 0 };
    const seedArtist = artistItems[Math.floor(Math.random() * artistItems.length)];
    const artistId = seedArtist.id;
    if (!artistId) return { tracks: [], total: 0 };
    const artistTopTracks = await this.handleGetArtistTopTracks({ id: artistId });
    const trackItems = artistTopTracks?.discography?.topTracks?.items ?? artistTopTracks?.tracks ?? [];
    const randomTrack = Array.isArray(trackItems) && trackItems.length > 0
      ? trackItems[Math.floor(Math.random() * trackItems.length)]
      : null;
    const trackId = randomTrack?.id ?? randomTrack?.track?.id ?? randomTrack?.uri?.split(":").pop();
    if (!trackId) return { tracks: [], total: 0 };
    const result = await this.performPathfinderRequest(
      "internalLinkRecommenderTrack", SpotifyOperationHash.internalLinkRecommenderTrack,
      { uri: `spotify:track:${trackId}`, limit: 50 }
    );
    const recItems = result?.data?.seoRecommendedTrack?.items ?? [];
    const tracks = recItems.map((item: any) => {
      const t = this.transformTrackResponse(item.data ?? item);
      delete t.album;
      return t;
    }).filter((t: any) => t.uri);
    return this.filterResponse({ tracks, total: tracks.length });
  }

  async handleGetLyrics(params: any): Promise<any> {
    const trackId = params.trackId || params.track_id || params.id;
    try {
      const accessToken = await this.getValidAccessToken();
      const res = await fetch(
        `https://spclient.wg.spotify.com/color-lyrics/v2/track/${trackId}?format=json&vocalRemoval=false&market=from_token`,
        {
          headers: {
            Accept: "application/json",
            "App-Platform": "WebPlayer",
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (res.ok) {
        const data = await res.json();
        const filtered = this.filterLyricsResponse(data);
        if (filtered?.lyrics?.lines?.length > 0) {
          return filtered;
        }
      }
    } catch {}

    const trackName = params.trackName || params.track_name;
    const artistName = params.artistName || params.artist_name;
    const albumName = params.albumName || params.album_name;
    const duration = params.duration;

    if (trackName && artistName) {
      return this.fetchLrcLibLyrics(trackName, artistName, albumName, duration);
    }
    return { lyrics: { lines: [], syncType: "NOT_SYNCED" } };
  }

  private async fetchLrcLibLyrics(trackName: string, artistName: string, albumName?: string, duration?: number): Promise<any> {
    const queryParams = new URLSearchParams({
      track_name: trackName,
      artist_name: artistName,
    });
    if (albumName) queryParams.set("album_name", albumName);
    if (duration) queryParams.set("duration", String(Math.floor(duration / 1000)));

    const res = await fetch(`https://lrclib.net/api/get?${queryParams}`);
    if (!res.ok) return { lyrics: { lines: [], syncType: "NOT_SYNCED" } };

    const data = await res.json();
    const lines: any[] = [];

    if (data.syncedLyrics) {
      for (const line of data.syncedLyrics.split("\n")) {
        const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2})\]\s*(.*)/);
        if (match) {
          const ms = parseInt(match[1]) * 60000 + parseInt(match[2]) * 1000 + parseInt(match[3]) * 10;
          lines.push({ words: match[4], startTimeMs: String(ms), endTimeMs: "0" });
        }
      }
      return { lyrics: { lines, syncType: "LINE_SYNCED" } };
    }

    if (data.plainLyrics) {
      for (const line of data.plainLyrics.split("\n")) {
        if (line.trim()) lines.push({ words: line, startTimeMs: "0", endTimeMs: "0" });
      }
    }
    return { lyrics: { lines, syncType: "NOT_SYNCED" } };
  }

  async handleSetPlaybackSpeed(params: any): Promise<any> {
    const accessToken = await this.getValidAccessToken();
    const spclient = this.spclientEndpoint || "gue1-spclient.spotify.com";
    const deviceId = params.device_id || params.deviceId || "unknown";

    await fetch(
      `https://${spclient}/connect-state/v1/player/command/from/${deviceId}/to/${deviceId}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ command: { playback_speed: params.speed, endpoint: "set_options" } }),
      }
    );
    return { success: true, speed: params.speed };
  }

  async handleDjStart(params: any): Promise<any> {
    const accessToken = await this.getValidAccessToken();
    const spclient = this.spclientEndpoint || "gue1-spclient.spotify.com";
    const deviceId = params.device_id || params.deviceId || "unknown";

    await fetch(
      `https://${spclient}/connect-state/v1/player/command/from/${deviceId}/to/${deviceId}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          command: {
            endpoint: "play",
            context: {
              entity_uri: "spotify:playlist:37i9dQZF1EYkqdzj48dyYq",
              uri: "spotify:playlist:37i9dQZF1EYkqdzj48dyYq",
              url: "hm://lexicon-session-provider/context-resolve/v2/session?contextUri=spotify:playlist:37i9dQZF1EYkqdzj48dyYq",
            },
          },
        }),
      }
    );
    return { success: true };
  }

  async handleDjSignal(params: any): Promise<any> {
    const accessToken = await this.getValidAccessToken();
    const spclient = this.spclientEndpoint || "gue1-spclient.spotify.com";
    const deviceId = params.device_id || params.deviceId || "unknown";

    await fetch(
      `https://${spclient}/connect-state/v1/player/command/from/${deviceId}/to/${deviceId}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ command: { endpoint: "signal", signal_id: "jump" } }),
      }
    );
    return { success: true };
  }

  async handleFetchImage(params: any): Promise<any> {
    const res = await fetch(params.url);
    if (!res.ok) throw new Error("Failed to fetch image");
    const buf = await res.arrayBuffer();
    const base64 = Buffer.from(buf).toString("base64");
    return {
      data: base64,
      contentType: res.headers.get("content-type") ?? "image/jpeg",
      size: buf.byteLength,
    };
  }

  private filterResponse(obj: any): any {
    if (!obj || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map((item) => this.filterResponse(item));

    const filtered = { ...obj };
    const removeKeys = [
      "available_markets", "preview_url", "disc_number", "copyrights",
      "audio_preview_url", "description", "html_description", "external_urls",
      "external_ids", "played_at", "seeds", "label", "is_local",
    ];
    for (const key of removeKeys) delete filtered[key];

    for (const key of Object.keys(filtered)) {
      if (typeof filtered[key] === "object" && filtered[key] !== null) {
        filtered[key] = this.filterResponse(filtered[key]);
      }
    }
    return filtered;
  }

  private filterLyricsResponse(obj: any): any {
    const filtered = { ...obj };
    delete filtered.colors;
    delete filtered.hasVocalRemoval;

    if (filtered.lyrics) {
      const lyrics = { ...filtered.lyrics };
      for (const key of ["alternatives", "capStatus", "isDenseTypeface", "isRtlLanguage",
        "language", "provider", "providerDisplayName", "providerLyricsId",
        "syncLyricsUri", "colors", "previewLines"]) {
        delete lyrics[key];
      }
      if (Array.isArray(lyrics.lines)) {
        lyrics.lines = lyrics.lines.map((line: any) => {
          const l = { ...line };
          delete l.syllables;
          delete l.transliteratedWords;
          return l;
        });
      }
      filtered.lyrics = lyrics;
    }
    return filtered;
  }

  async handleGetQueue(): Promise<any> {
    const accessToken = await this.getValidAccessToken();
    const spclient = this.spclientEndpoint || "gue1-spclient.spotify.com";
    const hobsId = `hobs_${crypto.randomUUID().replace(/-/g, "").substring(0, 40)}`;
    const connectionId = Array.from({ length: 148 }, () =>
      "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
    ).join("");

    const res = await fetch(`https://${spclient}/connect-state/v1/devices/${hobsId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Spotify-Connection-Id": connectionId,
      },
      body: JSON.stringify({
        member_type: "CONNECT_STATE",
        device: { device_info: { capabilities: { can_be_player: false, hidden: true, needs_full_player_state: true } } },
      }),
    });

    if (!res.ok) return { queue: [] };
    const state = await res.json();

    const nextTracks: any[] = state?.player_state?.next_tracks ?? [];
    const trackEntries = nextTracks
      .filter((t: any) => typeof t.uri === "string" && t.uri.startsWith("spotify:track:"))
      .slice(0, 10)
      .map((t: any) => ({ uri: t.uri as string, uid: t.uid as string | undefined }));

    const results = await Promise.all(
      trackEntries.map(async (trackEntry) => {
        try {
          const track = await this.fetchTrackDetails(trackEntry.uri);
          if (!track) return null;
          const entry: any = { uri: track.uri, name: track.name, explicit: track.explicit };
          if (trackEntry.uid) entry.uid = trackEntry.uid;
          if (track.album) {
            if (track.album.name) entry.album_name = track.album.name;
            if (track.album.uri) entry.album_uri = track.album.uri;
            const small = track.album.images?.find((s: any) => s.height === 64);
            if (small?.url) entry.image_url = small.url;
          }
          if (track.artists?.[0]?.uri) entry.artist_uri = track.artists[0].uri;
          return entry;
        } catch {
          log.warn(`Failed to fetch details for queue track ${trackEntry.uri}`);
          return null;
        }
      })
    );

    return { queue: results.filter(Boolean) };
  }

  async handleAddToQueue(params: any): Promise<any> {
    const uri = params.uri;
    if (!uri) throw new Error("Missing uri parameter");

    const accessToken = await this.getValidAccessToken();
    const spclient = this.spclientEndpoint || "gue1-spclient.spotify.com";

    let targetDeviceId = this._activeDeviceId;
    if (!targetDeviceId) {
      const devicesResult = await this.handleGetDevices();
      targetDeviceId = devicesResult.active_device_id ?? Object.keys(devicesResult.devices ?? {})[0];
      if (!targetDeviceId) throw new Error("No playback devices available");
    }

    const fromId = `hobs_${crypto.randomUUID().replace(/-/g, "").substring(0, 40)}`;
    const commandId = Array.from({ length: 16 }, () =>
      Math.floor(Math.random() * 256).toString(16).padStart(2, "0")
    ).join("");

    const res = await fetch(
      `https://${spclient}/connect-state/v1/player/command/from/${fromId}/to/${targetDeviceId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          command: {
            endpoint: "add_to_queue",
            track: {
              uri,
              metadata: { is_queued: "true" },
              provider: "queue",
            },
            logging_params: { command_id: commandId },
          },
        }),
      }
    );

    if (!res.ok) throw new Error(`Add to queue failed: ${res.status}`);
    return { success: true };
  }

  private async fetchTrackDetails(trackUri: string): Promise<any> {
    const result = await this.performPathfinderRequest(
      "getTrack",
      SpotifyOperationHash.getTrack,
      { uri: trackUri }
    );

    const trackUnion = result?.data?.trackUnion;
    if (!trackUnion) return null;

    const entry: any = { uri: trackUri };
    entry.name = trackUnion.name ?? "";
    entry.explicit = trackUnion.contentRating?.label === "EXPLICIT";

    const albumData = trackUnion.albumOfTrack;
    if (albumData) {
      const album: any = {};
      if (albumData.uri) { album.uri = albumData.uri; album.id = albumData.uri.split(":").pop() ?? ""; }
      if (albumData.name) album.name = albumData.name;
      if (albumData.coverArt?.sources) {
        album.images = albumData.coverArt.sources.map((s: any) => ({ url: s.url, height: s.height, width: s.width }));
      }
      entry.album = album;
    }

    const artistItems = trackUnion.artists?.items;
    if (Array.isArray(artistItems)) {
      entry.artists = this.flattenArtists(artistItems);
    }

    return entry;
  }

  transformConnectState(state: any): any {
    if (!state) return null;

    const ps = state.player_state;
    if (!ps?.track?.uri) return null;

    const track = ps.track;
    const metadata = track.metadata ?? {};
    const trackUri: string = track.uri;
    const trackId = trackUri.split(":").pop() ?? "";

    let imageUrl: string | null = null;
    const rawImage = metadata.image_url ?? metadata.image_xlarge_url ?? metadata.image_large_url;
    if (typeof rawImage === "string") {
      imageUrl = rawImage.startsWith("spotify:image:")
        ? "https://i.scdn.co/image/" + rawImage.slice("spotify:image:".length)
        : rawImage;
    }

    let artists: any[] = [];
    if (Array.isArray(metadata.artists) && metadata.artists.length > 0) {
      artists = metadata.artists;
    } else {
      const artistName = metadata.artist_name || metadata.album_artist_name || metadata.artist || "";
      if (artistName) {
        const artistUri = metadata.artist_uri ?? "";
        artists = [{ id: artistUri.split(":").pop() ?? "", name: artistName, uri: artistUri, type: "artist" }];
      }
    }

    const albumUri = metadata.album_uri ?? "";
    const album = {
      id: albumUri.split(":").pop() ?? "",
      name: metadata.album_title ?? "",
      artists: [],
      images: imageUrl ? [{ url: imageUrl, height: 300, width: 300 }] : [],
      uri: albumUri,
    };

    let durationMs = parseInt(ps.duration) || parseInt(metadata.duration) || parseInt(metadata.duration_ms) || 0;
    const progressMs = parseInt(ps.position_as_of_timestamp) || null;
    const timestamp = parseInt(ps.timestamp) || Date.now();

    const options = ps.options ?? {};
    const shuffleState = options.shuffling_context ?? false;
    let repeatState = "off";
    if (options.repeating_track) repeatState = "track";
    else if (options.repeating_context) repeatState = "context";

    let device = null;
    const activeDeviceId = state.active_device_id;
    if (activeDeviceId && state.devices?.[activeDeviceId]) {
      const d = state.devices[activeDeviceId];
      device = {
        id: activeDeviceId,
        is_active: true,
        is_private_session: false,
        name: d.name ?? "Unknown Device",
        type: d.device_type ?? "Unknown",
        volume_percent: d.volume != null ? Math.round((d.volume / 65535) * 100) : null,
      };
    }

    let context = null;
    if (ps.context_uri) {
      const parts = ps.context_uri.split(":");
      context = { type: parts.length >= 2 ? parts[1] : "", uri: ps.context_uri };
    }

    return {
      device,
      shuffle_state: shuffleState,
      repeat_state: repeatState,
      timestamp,
      progress_ms: progressMs,
      is_playing: !(ps.is_paused ?? true),
      item: {
        type: "track",
        id: trackId,
        name: metadata.title ?? "",
        artists,
        album,
        duration_ms: durationMs,
        uri: trackUri,
      },
      context,
    };
  }

  async handleSearch(params: any): Promise<any> {
    const query = String(params?.query ?? "");
    const requestedLimit = Number(params?.limit ?? 5);
    const limit = Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 5, 5);

    const result = await this.performPathfinderRequest(
      "searchDesktop",
      SpotifyOperationHash.searchDesktop,
      {
        searchTerm: query,
        offset: 0,
        limit,
        numberOfTopResults: limit,
        includeAudiobooks: false,
        includeArtistHasConcertsField: false,
        includePreReleases: false,
        includeAuthors: false,
        includeEpisodeContentRatingsV2: false,
      }
    );

    const searchV2 = result?.data?.searchV2;
    if (!searchV2 || typeof searchV2 !== "object") {
      throw new Error("Invalid search response");
    }

    return this.transformSearchResponse(searchV2);
  }

  private transformSearchResponse(searchV2: any): any {
    const out: any = {};

    const tracksV2Items = searchV2?.tracksV2?.items;
    if (Array.isArray(tracksV2Items)) {
      out.tracks = tracksV2Items
        .map((wrapper: any) => {
          const item = wrapper?.item;
          const trackData = item?.data;
          if (!trackData) return null;
          const artistItems = trackData?.artists?.items;
          const artistName = Array.isArray(artistItems)
            ? artistItems
                .map((a: any) => a?.profile?.name)
                .filter((n: any) => typeof n === "string" && n.length > 0)
                .join(", ")
            : "";
          const sources = trackData?.albumOfTrack?.coverArt?.sources;
          return {
            name: trackData.name ?? "",
            artist: artistName,
            uri: trackData.uri ?? "",
            image_url: this.firstImageUrl(sources),
          };
        })
        .filter((x: any) => x !== null);
    }

    const artistItems = searchV2?.artists?.items;
    if (Array.isArray(artistItems)) {
      out.artists = artistItems
        .map((wrapper: any) => {
          const data = wrapper?.data;
          if (!data) return null;
          const sources = data?.visuals?.avatarImage?.sources;
          return {
            name: data?.profile?.name ?? "",
            uri: data?.uri ?? "",
            image_url: this.firstImageUrl(sources),
          };
        })
        .filter((x: any) => x !== null);
    }

    const albumsV2Items = searchV2?.albumsV2?.items;
    if (Array.isArray(albumsV2Items)) {
      out.albums = albumsV2Items
        .map((wrapper: any) => {
          const data = wrapper?.data;
          if (!data) return null;
          const albumArtistItems = data?.artists?.items;
          const artistName = Array.isArray(albumArtistItems)
            ? albumArtistItems
                .map((a: any) => a?.profile?.name)
                .filter((n: any) => typeof n === "string" && n.length > 0)
                .join(", ")
            : "";
          const sources = data?.coverArt?.sources;
          return {
            name: data?.name ?? "",
            artist: artistName,
            uri: data?.uri ?? "",
            image_url: this.firstImageUrl(sources),
          };
        })
        .filter((x: any) => x !== null);
    }

    const playlistItems = searchV2?.playlists?.items;
    if (Array.isArray(playlistItems)) {
      out.playlists = playlistItems
        .map((wrapper: any) => {
          const data = wrapper?.data;
          if (!data) return null;
          const imageItems = data?.images?.items;
          const sources = Array.isArray(imageItems) ? imageItems[0]?.sources : null;
          return {
            name: data?.name ?? "",
            uri: data?.uri ?? "",
            image_url: this.firstImageUrl(sources),
          };
        })
        .filter((x: any) => x !== null);
    }

    return out;
  }

  private firstImageUrl(sources: any): string {
    if (!Array.isArray(sources) || sources.length === 0) return "";
    const url = sources[0]?.url;
    return typeof url === "string" ? url : "";
  }
}
