import { RPCClient, type RPCClientDelegate } from "./rpc/rpc-client";
import { SpotifyService } from "./services/spotify-service";
import { SpotifyCommandDispatcher } from "./services/spotify-commands";
import { SpotifyWebSocketService, type SpotifyWebSocketDelegate } from "./services/spotify-websocket";
import { OTAService } from "./services/ota-service";
import { BluetoothService } from "./services/bluetooth-service";
import { AuthService } from "./services/auth-service";
import { SetupStateService } from "./services/setup-state-service";
import { AnalyticsService } from "./services/analytics-service";
import { SpotifyDatabaseStorage } from "./services/spotify-database";
import { createLogger } from "./utils/logger";
import { getConnectorVersion } from "./utils/version";
import { existsSync, statSync } from "fs";

const log = createLogger("NocturneManager");

interface DeviceConnection {
  rpcClient: RPCClient;
  deviceInfo: any;
}

type WSBroadcast = (type: string, data: any) => void;

export class NocturneManager implements RPCClientDelegate, SpotifyWebSocketDelegate {
  readonly authService: AuthService;
  readonly spotifyService: SpotifyService;
  readonly analyticsService: AnalyticsService;
  private spotifyCommands: SpotifyCommandDispatcher;
  private spotifyWebSocket: SpotifyWebSocketService;
  readonly otaService = new OTAService();
  readonly bluetoothService = new BluetoothService();
  readonly setupStateService = new SetupStateService();

  private connections = new Map<string, DeviceConnection>();
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private didSendInitialPing = false;
  private wsBroadcast: WSBroadcast | null = null;
  private downloadedOTAFilePath: string | null = null;
  private cachedPlayerState: any = null;

  constructor() {
    this.authService = new AuthService();
    const dbStorage = new SpotifyDatabaseStorage(this.authService.client);
    this.spotifyService = new SpotifyService(dbStorage, () => this.authService.currentUser?.id ?? null);
    this.analyticsService = new AnalyticsService(this.authService.client);
    this.spotifyCommands = new SpotifyCommandDispatcher(this.spotifyService);
    this.spotifyWebSocket = new SpotifyWebSocketService(this.spotifyService);
    this.spotifyWebSocket.setDelegate(this);

    this.authService.onAuthStateChange(async (user) => {
      await this.spotifyService.checkAuthStatus();
      if (user) {
        this.analyticsService.syncPendingAnalytics().catch((err) => {
          log.warn(`Analytics sync failed: ${err}`);
        });
      }
    });

    this.spotifyService.onAuthStateChange((state) => {
      this.broadcastToWebSocket("spotify.auth.status", state);
      this.broadcastToDevices("spotify.auth.status", {
        authenticated: state.status === "linked",
        skipped: false,
      });

      if (state.status === "loading" || state.status === "polling") {
        this.broadcastToDevices("spotify.auth.started", {
          status: "authorization_started",
        });
      }

      if (state.status === "linked") {
        this.broadcastToDevices("spotify.auth.completed", {
          authenticated: true,
        });
        this.spotifyWebSocket.connect().catch((err) => log.error(`WebSocket connect failed: ${err}`));
      } else {
        this.spotifyWebSocket.disconnect();
      }
    });
  }

  setWSBroadcast(broadcast: WSBroadcast): void {
    this.wsBroadcast = broadcast;
  }

  private broadcastToWebSocket(type: string, data: any): void {
    this.wsBroadcast?.(type, data);
  }

  async initializeOffline(): Promise<void> {
    await this.bluetoothService.initialize();

    this.bluetoothService.rfcommServer.setDataHandler((devicePath, data) => {
      const conn = this.connections.get(devicePath);
      if (conn) conn.rpcClient.handleIncomingData(data);
    });

    this.bluetoothService.rfcommOutbound.setDataHandler((data) => {
      const address = this.bluetoothService.rfcommOutbound.address;
      const devicePath = `rfcomm-client:${address}`;
      const conn = this.connections.get(devicePath);
      if (conn) conn.rpcClient.handleIncomingData(data);
    });

    this.bluetoothService.onEvent((event, data) => {
      if (event === "deviceConnected") {
        this.handleNewConnection(data.devicePath, data.address);
      } else if (event === "deviceDisconnected") {
        this.handleDisconnection(data.devicePath);
      }
      this.broadcastToWebSocket(`bluetooth.${event}`, data);
    });

    log.info("NocturneManager offline init complete (Bluetooth ready)");
  }

  async initializeOnline(): Promise<void> {
    await this.authService.initialize();
    if (this.connections.size > 0) {
      await this.sendAppReady();
    }
    log.info("NocturneManager online init complete (auth restored or pending)");
  }

  private handleNewConnection(devicePath: string, address: string): void {
    const isOutbound = devicePath.startsWith("rfcomm-client:");
    const rpcClient = new RPCClient(devicePath, "base64-newline");
    rpcClient.setDelegate(this);
    rpcClient.setSocket({
      write: (data: Buffer | Uint8Array) => {
        if (isOutbound) {
          this.bluetoothService.rfcommOutbound.write(Buffer.from(data));
        } else {
          this.bluetoothService.rfcommServer.writeToDevice(devicePath, Buffer.from(data));
        }
      },
      end: () => {},
    });

    this.connections.set(devicePath, { rpcClient, deviceInfo: null });
    this.didSendInitialPing = false;
    this.startKeepAlive(15);

    this.broadcastToWebSocket("device.connected", { devicePath, address });

    setTimeout(() => this.sendInitialPing(devicePath), 500);
  }

  private handleDisconnection(devicePath: string): void {
    const conn = this.connections.get(devicePath);
    if (conn) {
      conn.rpcClient.cleanup();
      this.connections.delete(devicePath);
    }

    if (this.connections.size === 0) {
      this.stopKeepAlive();
    }

    this.broadcastToWebSocket("device.disconnected", { devicePath });
  }

  private async sendInitialPing(connectionID: string): Promise<void> {
    const conn = this.connections.get(connectionID);
    if (!conn) return;

    try {
      await conn.rpcClient.call("ping", { message: "RPi connected" });
      const deviceInfo = await conn.rpcClient.call("device.info", {});
      conn.deviceInfo = deviceInfo;

      log.info(`Initial ping sent to ${connectionID}`);
      this.broadcastToWebSocket("device.info", deviceInfo);

      this.recordConnectionAnalytics(deviceInfo);

      await this.sendAppReady();
    } catch (err) {
      log.error(`Initial ping failed for ${connectionID}: ${err}`);
    }
  }

  private recordConnectionAnalytics(deviceInfo: any): void {
    const mfiSerial =
      typeof deviceInfo?.serialNumber === "string" && deviceInfo.serialNumber.length > 0
        ? deviceInfo.serialNumber
        : "unknown";
    const firmwareVersion =
      typeof deviceInfo?.version === "string" && deviceInfo.version.length > 0
        ? deviceInfo.version
        : "unknown";
    const shortSerial = mfiSerial.length >= 4 ? mfiSerial.slice(-4) : mfiSerial;
    const deviceName = `Nocturne (${shortSerial})`;
    const userId = this.authService.currentUser?.id ?? null;
    const appVersion = getConnectorVersion();

    this.analyticsService
      .recordDailyActive({
        deviceSerial: mfiSerial,
        userId,
        appVersion,
        firmwareVersion,
        phoneVersion: "Connector",
      })
      .catch((err) => log.warn(`recordDailyActive failed: ${err}`));

    this.analyticsService
      .trackEvent({
        deviceSerial: mfiSerial,
        userId,
        eventType: "connection.established",
        eventData: {
          device: deviceName,
          mfi_serial: mfiSerial,
          firmware_version: firmwareVersion,
        },
      })
      .catch((err) => log.warn(`trackEvent connection.established failed: ${err}`));
  }

  private async sendAppReady(): Promise<void> {
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const tzOffset = -now.getTimezoneOffset() * 60;
    const isAuthenticated = this.spotifyService.authState.status === "linked";
    const pad = (n: number) => String(n).padStart(2, "0");
    const datetime = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const tzAbbr = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value ?? "";
    const jan = new Date(now.getFullYear(), 0, 1).getTimezoneOffset();
    const jul = new Date(now.getFullYear(), 6, 1).getTimezoneOffset();
    const isDST = now.getTimezoneOffset() < Math.max(jan, jul);

    await this.broadcastToDevices("spotify.auth.status", {
      authenticated: isAuthenticated,
      skipped: false,
    });

    await this.broadcastToDevices("app.ready", {
      platform: "web",
      timestamp: Date.now(),
      spotifySkipped: false,
      datetime,
      time,
      timezone: {
        identifier: tz,
        secondsFromGMT: tzOffset,
        abbreviation: tzAbbr,
        isDaylightSavingTime: isDST,
      },
    });

    log.info("Sent app.ready in response to daemon.ready");
  }

  private startKeepAlive(intervalSec: number): void {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(async () => {
      for (const [id, conn] of this.connections) {
        try {
          await conn.rpcClient.call("ping", { message: "keepalive", volumePercent: 50 });
        } catch (err) {
          log.warn(`Keep-alive failed for ${id}: ${err}`);
        }
      }
    }, intervalSec * 1000);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private async broadcastToDevices(topic: string, data: any): Promise<void> {
    for (const [id, conn] of this.connections) {
      try {
        await conn.rpcClient.sendEvent(topic, data);
      } catch (err) {
        log.warn(`Broadcast to ${id} failed: ${err}`);
      }
    }
  }

  async onCall(id: string, method: string, params: unknown): Promise<{ result?: unknown; error?: string }> {
    log.info(`RPC call: ${method}`);
    const p = (params as any) ?? {};

    try {
      if (method === "ping") {
        return { result: { pong: p.message || "pong" } };
      }

      if (method === "device.info") {
        return { result: { device: "nocturne-connector", version: getConnectorVersion() } };
      }

      if (method === "spotify.auth.getStatus") {
        return { result: { authenticated: this.spotifyService.authState.status === "linked", skipped: false } };
      }

      if (method.startsWith("spotify.") && method !== "spotify.auth.getStatus") {
        const result = await this.spotifyCommands.dispatch(method, p);
        return { result };
      }

      if (method === "device.ota.check") {
        const currentVersion = p.currentVersion ?? "unknown";
        const result = await this.otaService.checkForUpdates(currentVersion, "beta");
        return {
          result: {
            updateAvailable: result.updateAvailable,
            version: result.version,
            channel: result.channel,
            metadata: result.metadata,
          },
        };
      }

      if (method === "device.ota.download") {
        const filePath = await this.otaService.downloadUpdate(
          p.currentVersion ?? "unknown",
          p.targetVersion ?? "unknown"
        );
        this.downloadedOTAFilePath = filePath;
        const stat = statSync(filePath);
        const md5 = this.otaService.calculateMD5(filePath);

        await this.broadcastToDevices("device.ota.package_state", {
          state: "download_success",
          name: "nocturne-os",
          version: p.targetVersion,
          hash: md5,
          size: stat.size,
        });

        return { result: { success: true, message: "Update downloaded, ready for transfer" } };
      }

      if (method === "device.ota.transfer") {
        if (!this.downloadedOTAFilePath) return { error: "No OTA file available" };
        const chunk = this.otaService.readChunk(
          this.downloadedOTAFilePath,
          p.offset ?? 0,
          p.size ?? 31680
        );
        return { result: { data: chunk } };
      }

      if (method === "device.timezone.get") {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const offset = -new Date().getTimezoneOffset() * 60;
        return {
          result: {
            identifier: tz,
            secondsFromGMT: offset,
            abbreviation: "",
            isDaylightSavingTime: false,
          },
        };
      }

      if (method === "device.time.get") {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        const datetime = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
        const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        return { result: { datetime, time } };
      }

      log.warn(`Unknown method: ${method}`);
      return { error: `Unknown method: ${method}` };
    } catch (err: any) {
      log.error(`RPC call ${method} failed: ${err.message}`);
      return { error: err.message };
    }
  }

  onEvent(topic: string, data: unknown): void {
    if (topic === "chunk.retransmit_request") {
      const d = data as any;
      const messageId = d?.message_id;
      const chunkIdx = d?.chunk_idx;
      if (messageId != null && chunkIdx != null) {
        for (const [, conn] of this.connections) {
          conn.rpcClient.retransmitChunk(messageId, chunkIdx).catch(() => {});
        }
      }
    } else if (topic === "daemon.ready") {
      this.sendAppReady().catch((err) => log.error(`Failed to send app.ready: ${err}`));
    }
  }

  onError(error: Error): void {
    log.error(`RPC error: ${error.message}`);
  }

  onDisconnect(): void {
    log.info("RPC client disconnected");
  }

  onPlayerEvent(event: any): void {
    const { cleanupWebSocketMessage } = require("./services/spotify-filters");
    const result = cleanupWebSocketMessage(event);
    if (!result) return;

    this.enrichTrackMetadata(result.data)
      .then(() => {
        this.cachePlayerState(result.data);
        this.broadcastToDevices(result.topic, result.data);
        this.broadcastToWebSocket(result.topic, result.data);
      })
      .catch(() => {
        this.cachePlayerState(result.data);
        this.broadcastToDevices(result.topic, result.data);
        this.broadcastToWebSocket(result.topic, result.data);
      });
  }

  private cachePlayerState(data: any): void {
    const cluster = data?.payloads?.[0]?.cluster;
    if (cluster?.player_state) {
      this.cachedPlayerState = cluster;
    }
    const activeDeviceId = cluster?.active_device_id;
    if (activeDeviceId) {
      this.spotifyService.setActiveDeviceId(activeDeviceId);
    }
  }

  private async enrichTrackMetadata(data: any): Promise<void> {
    const playerState = data?.payloads?.[0]?.cluster?.player_state;
    const track = playerState?.track;
    if (!playerState || !track?.uri) return;

    track.metadata = track.metadata ?? {};
    const uri: string = track.uri;

    if (uri.startsWith("spotify:track:")) {
      const trackId = uri.slice("spotify:track:".length);
      const info = await this.spotifyService.fetchTrackInfo(trackId);
      if (info) {
        this.spotifyService.mergeTrackInfoIntoPlayerState(playerState, info);
      }
    } else if (uri.startsWith("spotify:local:")) {
      const parts = uri.split(":");
      if (parts.length >= 5 && (!Array.isArray(track.metadata.artists) || track.metadata.artists.length === 0)) {
        const decoded = decodeURIComponent(parts[2]).replace(/\+/g, " ");
        const names = decoded.split(",").map((n) => n.trim()).filter(Boolean);
        track.metadata.artists = names.map((name) => ({
          id: "",
          name,
          uri: "",
          type: "artist",
        }));
      }
    }
  }

  onConnectionStateChange(connected: boolean): void {
    this.broadcastToWebSocket("spotify.websocket.status", { connected });
  }

  getConnectionStatus(): { connected: boolean; deviceCount: number; devices: any[] } {
    const devices = Array.from(this.connections.entries()).map(([id, conn]) => ({
      id,
      deviceInfo: conn.deviceInfo,
    }));
    return {
      connected: this.connections.size > 0,
      deviceCount: this.connections.size,
      devices,
    };
  }
}
