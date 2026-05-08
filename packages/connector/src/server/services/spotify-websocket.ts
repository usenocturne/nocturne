import type { SpotifyService } from "./spotify-service";
import { createLogger } from "../utils/logger";

const log = createLogger("SpotifyWebSocket");

export interface SpotifyWebSocketDelegate {
  onPlayerEvent(event: any): void;
  onConnectionStateChange(connected: boolean): void;
  onError(error: Error): void;
}

export class SpotifyWebSocketService {
  private ws: WebSocket | null = null;
  private delegate: SpotifyWebSocketDelegate | null = null;
  private spotify: SpotifyService;

  private dealerEndpoint: string | null = null;
  private _spclientEndpoint: string | null = null;
  private _connectionId: string | null = null;
  private _isConnected = false;
  private isConnecting = false;
  private hasReceivedConnectionId = false;
  private shouldMaintainConnection = true;
  private isIntentionalDisconnect = false;
  private reconnectAttempts = 0;
  private reconnectBaseDelay = 1000;
  private reconnectMaxDelay = 60_000;

  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMessageTime = Date.now();
  private connectionTimeout = 180_000; // 3 minutes
  private tokenRefreshInterval = 50 * 60 * 1000; // 50 minutes

  constructor(spotify: SpotifyService) {
    this.spotify = spotify;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  get connectionId(): string | null {
    return this._connectionId;
  }

  get spclientEndpoint(): string | null {
    return this._spclientEndpoint;
  }

  setDelegate(delegate: SpotifyWebSocketDelegate): void {
    this.delegate = delegate;
  }

  private async resolveEndpoints(): Promise<{ dealer: string; spclient: string }> {
    if (this.dealerEndpoint && this._spclientEndpoint) {
      return { dealer: this.dealerEndpoint, spclient: this._spclientEndpoint };
    }

    const res = await fetch("https://apresolve.spotify.com/?type=dealer-g2&type=spclient");
    if (!res.ok) throw new Error("Failed to resolve endpoints");
    const data = await res.json();

    const dealerArray = data["dealer-g2"] || data["dealer"] || [];
    const spclientArray = data["spclient"] || [];

    if (!dealerArray.length || !spclientArray.length) {
      throw new Error("Missing dealer or spclient endpoints");
    }

    const dealer = dealerArray[0].split(":")[0];
    const spclient = spclientArray[0].split(":")[0];

    this.dealerEndpoint = dealer;
    this._spclientEndpoint = spclient;
    this.spotify.setSpclientEndpoint(spclient);

    return { dealer, spclient };
  }

  async connect(): Promise<void> {
    if (this._isConnected || this.isConnecting) return;

    this.isConnecting = true;
    this.shouldMaintainConnection = true;
    this.hasReceivedConnectionId = false;

    try {
      const { dealer } = await this.resolveEndpoints();
      const accessToken = await this.spotify.getValidAccessToken();

      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }

      this.ws = new WebSocket(`wss://${dealer}/?access_token=${accessToken}`);

      this.ws.onopen = () => {
        this._isConnected = true;
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.lastMessageTime = Date.now();
        this.delegate?.onConnectionStateChange(true);
        this.startPingTimer();
        this.startHealthCheck();
        this.startTokenRefreshTimer();
      };

      this.ws.onmessage = (event) => {
        this.lastMessageTime = Date.now();
        this.handleMessage(String(event.data));
      };

      this.ws.onerror = (event) => {
        if (!this.isIntentionalDisconnect) {
          log.error("WebSocket error");
          this.handleConnectionError(new Error("WebSocket error"));
        }
      };

      this.ws.onclose = () => {
        if (!this.isIntentionalDisconnect) {
          this.handleConnectionError(new Error("Connection closed"));
        }
      };
    } catch (err) {
      this.isConnecting = false;
      throw err;
    }
  }

  disconnect(): void {
    this.shouldMaintainConnection = false;
    this.isIntentionalDisconnect = true;
    this.stopPingTimer();
    this.stopReconnectTimer();
    this.stopHealthCheck();
    this.stopTokenRefreshTimer();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this._isConnected = false;
    this.isConnecting = false;
    this.hasReceivedConnectionId = false;
    this._connectionId = null;
    this.delegate?.onConnectionStateChange(false);

    setTimeout(() => {
      this.isIntentionalDisconnect = false;
    }, 100);
  }

  private handleMessage(text: string): void {
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      log.error("Failed to parse WebSocket message");
      return;
    }

    if (!this.hasReceivedConnectionId) {
      const connId = json?.headers?.["Spotify-Connection-Id"];
      if (connId) {
        this._connectionId = connId;
        this.hasReceivedConnectionId = true;
        this.registerDevice().catch((err) => log.error(`Device registration failed: ${err}`));
        this.delegate?.onPlayerEvent(json);
        return;
      }
    }

    if (json.type === "pong") return;

    if (json.payloads) {
      this.delegate?.onPlayerEvent(json);
    }
  }

  private async registerDevice(): Promise<void> {
    if (!this._connectionId || !this._spclientEndpoint) return;

    const accessToken = await this.spotify.getValidAccessToken();
    const deviceId = Array.from({ length: 40 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).joined("");

    const hobsId = `hobs_${deviceId}`;
    const res = await fetch(
      `https://${this._spclientEndpoint}/connect-state/v1/devices/${hobsId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Spotify-Connection-Id": this._connectionId,
        },
        body: JSON.stringify({
          member_type: "CONNECT_STATE",
          device: {
            device_info: {
              capabilities: {
                can_be_player: false,
                hidden: true,
                needs_full_player_state: true,
              },
            },
          },
        }),
      }
    );

    if (!res.ok && res.status !== 204) {
      log.error(`Device registration failed: ${res.status}`);
    }
  }

  private startPingTimer(): void {
    this.stopPingTimer();
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send('{"type":"ping"}');
      }
    }, 10_000);
  }

  private stopPingTimer(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private startHealthCheck(): void {
    this.stopHealthCheck();
    this.healthCheckInterval = setInterval(() => {
      if (!this._isConnected) return;
      if (Date.now() - this.lastMessageTime > this.connectionTimeout) {
        log.warn("Connection stale, reconnecting...");
        this.reconnect().catch((err) => log.error(`Stale reconnect failed: ${err}`));
      }
    }, 30_000);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  private startTokenRefreshTimer(): void {
    this.stopTokenRefreshTimer();
    this.tokenRefreshTimer = setTimeout(async () => {
      if (!this._isConnected || !this.shouldMaintainConnection) return;
      log.info("Token refresh interval reached, reconnecting with fresh token...");
      await this.reconnect();
    }, this.tokenRefreshInterval);
  }

  private stopTokenRefreshTimer(): void {
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }
  }

  private handleConnectionError(error: Error): void {
    if (this.isIntentionalDisconnect) return;

    this._isConnected = false;
    this.isConnecting = false;
    this.hasReceivedConnectionId = false;
    this.stopPingTimer();
    this.stopHealthCheck();
    this.stopTokenRefreshTimer();

    this.delegate?.onError(error);
    this.delegate?.onConnectionStateChange(false);

    if (this.shouldMaintainConnection) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    this.stopReconnectTimer();
    this.reconnectAttempts++;
    const baseDelay = Math.min(
      this.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.reconnectMaxDelay
    );
    const jitter = 0.5 + Math.random() * 0.5;
    const delay = Math.round(baseDelay * jitter);

    log.info(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${(delay / 1000).toFixed(1)}s`);

    this.reconnectTimeout = setTimeout(async () => {
      if (this.shouldMaintainConnection && !this._isConnected) {
        try {
          await this.connect();
        } catch (err) {
          log.error(`Reconnect attempt ${this.reconnectAttempts} failed: ${err}`);
          if (this.shouldMaintainConnection) {
            this.scheduleReconnect();
          }
        }
      }
    }, delay);
  }

  private stopReconnectTimer(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  async reconnect(): Promise<void> {
    this.disconnect();
    this.reconnectAttempts = 0;
    await new Promise((r) => setTimeout(r, 100));
    this.isIntentionalDisconnect = false;
    await this.connect();
  }
}

declare global {
  interface Array<T> {
    joined(separator: string): string;
  }
}

Array.prototype.joined = function (separator: string): string {
  return this.join(separator);
};
