import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import type { Server } from "bun";
import { PORT } from "./config";
import { createLogger } from "./utils/logger";
import { NocturneManager } from "./nocturne-manager";
import { infoRoutes } from "./routes/info";
import { powerRoutes } from "./routes/power";
import { createAuthRoutes } from "./routes/auth";
import { createSetupRoutes } from "./routes/setup";
import { createSpotifyRoutes } from "./routes/spotify";
import { createBluetoothRoutes } from "./routes/bluetooth";
import { createDeviceRoutes } from "./routes/device";
import { createAnalyticsRoutes } from "./routes/analytics";
import { existsSync } from "fs";

const log = createLogger("Server");

const WS_TOPIC = "events";
let serverRef: Server<unknown> | null = null;
let wsClientCount = 0;

function broadcast(type: string, data: any): void {
  if (!serverRef) return;
  const msg = JSON.stringify({ type: "event", topic: type, data });
  serverRef.publish(WS_TOPIC, msg);
}

async function fetchAndApplyTimezone(): Promise<void> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const tzRes = await fetch("https://api.usenocturne.com/v1/timezone");
      if (!tzRes.ok) {
        log.warn(`Timezone fetch attempt ${attempt} returned HTTP ${tzRes.status}`);
      } else {
        const { timezone } = (await tzRes.json()) as { timezone?: string };
        if (timezone) {
          process.env.TZ = timezone;
          const { writeFileSync, existsSync, symlinkSync, unlinkSync } = await import("fs");
          const zonefile = `/usr/share/zoneinfo/${timezone}`;
          if (existsSync(zonefile)) {
            try { unlinkSync("/etc/localtime"); } catch {}
            symlinkSync(zonefile, "/etc/localtime");
            writeFileSync("/etc/timezone", timezone + "\n");
          }
          log.info(`Timezone set to ${timezone}`);
          return;
        }
      }
    } catch (err) {
      log.warn(`Timezone fetch attempt ${attempt} failed: ${err}`);
    }
    if (attempt < maxAttempts) {
      const backoffMs = 1000 * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  log.warn("Giving up on timezone fetch after 3 attempts; using system default");
}

async function main() {
  log.info("Starting Nocturne Connector...");

  const manager = new NocturneManager();
  manager.setWSBroadcast(broadcast);
  await manager.initialize();

  const app = new Elysia()
    .use(cors())
    .use(infoRoutes)
    .use(powerRoutes)
    .use(createAuthRoutes(manager.authService, manager.setupStateService))
    .use(createSetupRoutes(manager.setupStateService))
    .use(createSpotifyRoutes(manager.spotifyService))
    .use(createBluetoothRoutes(manager.bluetoothService))
    .use(createDeviceRoutes(manager))
    .use(createAnalyticsRoutes(manager.analyticsService))
    .ws("/ws", {
      open(ws) {
        ws.subscribe(WS_TOPIC);
        wsClientCount++;
        log.info(`WebSocket client connected (${wsClientCount} total)`);
      },
      message(ws, message) {
        try {
          const msg = typeof message === "string" ? JSON.parse(message) : message;
          if (msg.type === "request" && msg.method) {
            manager
              .onCall(msg.id || "ws", msg.method, msg.params || {})
              .then((response) => {
                ws.send(
                  JSON.stringify({
                    type: "response",
                    id: msg.id,
                    ...(response.error
                      ? { error: response.error }
                      : { result: response.result }),
                  })
                );
              })
              .catch((err: any) => {
                ws.send(
                  JSON.stringify({
                    type: "response",
                    id: msg.id,
                    error: err.message,
                  })
                );
              });
          }
        } catch {
        }
      },
      close() {
        wsClientCount = Math.max(0, wsClientCount - 1);
        log.info(`WebSocket client disconnected (${wsClientCount} remaining)`);
      },
    });

  const staticDir = new URL("../dist/client", import.meta.url).pathname;
  log.info(`Static file directory: ${staticDir} (exists: ${existsSync(staticDir)})`);
  if (existsSync(staticDir)) {
    const mimeTypes: Record<string, string> = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".mjs": "application/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
    };

    const getMime = (path: string): string => {
      const ext = path.substring(path.lastIndexOf("."));
      return mimeTypes[ext] || "application/octet-stream";
    };

    app.get("/assets/*", ({ params }) => {
      const filePath = `${staticDir}/assets/${params["*"]}`;
      const file = Bun.file(filePath);
      return new Response(file, {
        headers: { "content-type": getMime(filePath) },
      });
    });

    app.get("*", ({ path }) => {
      if (path.startsWith("/api/") || path === "/ws") return;
      return new Response(Bun.file(`${staticDir}/index.html`), {
        headers: { "content-type": "text/html" },
      });
    });
  }

  app.listen(PORT);
  serverRef = app.server ?? null;
  log.info(`Server listening on http://0.0.0.0:${PORT}`);

  fetchAndApplyTimezone().catch((err) => {
    log.warn(`Background timezone fetch failed: ${err}`);
  });
  manager.spotifyService.checkAuthStatus().catch((err) => {
    log.warn(`Background Spotify auth check failed: ${err}`);
  });
}

main().catch((err) => {
  log.error(`Fatal error: ${err}`);
  process.exit(1);
});
