# NOCTURNE-CONNECTOR — RASPBERRY PI Wi-Fi BRIDGE + SETUP UI

**Generated:** 2026-05-05
**Runtime (server):** Bun + TypeScript + Elysia
**Runtime (UI):** Vite + React 19 + Tailwind 4 + Radix UI
**Image:** Alpine-based, built via `raspi-alpine` builder
**Related repos:** `nocturned` (the daemon on the Car Thing this bridges Spotify auth + BT to), `nocturne-ui` (the kiosk UI on the Car Thing — independent), `nocturne-image` (firmware that pairs with this device).

## OVERVIEW

A flashable Raspberry Pi OS image (~60 MB) that gives the Car Thing internet by USB-tethering Wi-Fi from the Pi, while running a local web UI at `http://nocturne-connector.local` for:

1. **Initial setup wizard** (Wi-Fi, account login, BT pair the Car Thing)
2. **Spotify account linking** (OAuth callback handling)
3. **Bridge RPC** between phone/cloud services and the Car Thing

The Pi acts as a controller box; the Car Thing remains the primary user-facing device.

## STRUCTURE

```
nocturne-connector/
├── README.md
├── LICENSE                       # Apache (NOT GPL — separate from firmware repos)
├── Justfile                      # connector-api, run, lint, docker-qemu
├── build.sh                      # Top-level builder — produces output/*.img.gz
├── wpa_supplicant.conf           # Default Wi-Fi config baked into image (user edits before flash)
├── scripts/
├── resources/                    # Image-build assets
├── cache/                        # Build cache (gitignored)
├── output/                       # Final flashable image: nocturne-connector_v<X>.img.gz + .sha256
└── src/                          # The actual Bun application — gets baked into the Pi rootfs
    ├── package.json              # bun + vite + elysia + react + dbus-next + supabase-js
    ├── bunfig.toml
    ├── tsconfig.json
    ├── vite.config.ts            # Frontend build → src/dist/client/
    ├── components.json           # Radix UI / shadcn config
    ├── server/
    │   ├── index.ts              # Elysia entrypoint: REST /api/* + WS /ws (topic "events")
    │   ├── nocturne-manager.ts   # CORE orchestrator — RPC bridge + event broadcast
    │   ├── routes/
    │   │   ├── auth.ts           # /api/auth — Supabase OTP, sign-in, callbacks
    │   │   ├── spotify.ts        # /api/spotify — link/disconnect Spotify accounts
    │   │   ├── info.ts           # /api/info — version, OS
    │   │   ├── setup.ts          # /api/setup — onboarding state machine
    │   │   └── power.ts          # /api/power — reboot / shutdown
    │   ├── services/
    │   │   ├── auth-service.ts
    │   │   ├── spotify-service.ts
    │   │   ├── bluetooth-service.ts   # dbus-next → BlueZ (BT pair the Car Thing)
    │   │   ├── ota-service.ts
    │   │   └── analytics-service.ts
    │   ├── rpc/                  # Type-safe RPC client/server primitives
    │   └── utils/
    │       ├── logger.ts
    │       ├── encryption.ts
    │       └── version.ts
    └── client/                   # React UI (built into src/dist/client/)
        ├── main.tsx
        ├── App.tsx               # Router + theme provider
        ├── pages/                # SetupWizard.tsx, Dashboard.tsx, SpotifyAuth.tsx, ...
        ├── components/           # Layout.tsx, ThemeProvider.tsx, ui/* (Radix wrappers)
        └── hooks/                # useAuth, useWebSocket, ...
```

## SERVER ↔ CLIENT WIRE CONTRACT

| Surface          | Protocol                | Notes                                                                         |
| ---------------- | ----------------------- | ----------------------------------------------------------------------------- |
| `/api/*`         | HTTP REST (JSON)        | Elysia routes; auth/spotify/info/setup/power                                  |
| `/ws`            | WebSocket               | Single broadcast topic `events`; clients subscribe and receive everything    |
| (server-internal)| RPC over WebSocket      | `nocturne-manager.ts` exposes `onCall(method, handler)` + `onEvent(name, h)` for the BT-tethered Car Thing to call into |

The browser UI talks to the server only via REST + WS; it does NOT implement the RPC layer (that's used between this Pi and the Car Thing).

## CONVENTIONS

- **`src/` IS the deployable.** The image-build process drops `src/` (post-`bun run build`) into the Alpine rootfs at a fixed path, then uses `init` to `bun run start` it on boot.
- **Frontend is built ahead of time.** Vite outputs to `src/dist/client/`, served as static files by Elysia (`@elysiajs/static`). No SSR.
- **Logger is the only sanctioned log call.** `src/server/utils/logger.ts` (level-based: debug/info/warn/error). Avoid bare `console.log` in `src/server/**`.
- **DBus is the BT API**, not bluez-tools/bluetoothctl shell-outs. `dbus-next` in `bluetooth-service.ts`.
- **State persists in Supabase** (`@supabase/supabase-js`), not local SQLite — multi-device users expect their Pi state in the cloud.
- **Encryption helpers live in one place** (`server/utils/encryption.ts`); don't roll your own.

## ANTI-PATTERNS

- **Don't commit `wpa_supplicant.conf` with real credentials.** The repo file ships with placeholders; users fill it in on the SD card after flash.
- **Don't add bluetooth handling in `routes/`.** Routes are thin HTTP handlers — push device logic into `services/bluetooth-service.ts` so the WS RPC path can reuse it.
- **Don't introduce `node-*` packages** without checking Bun compat. The runtime is Bun, not Node — some `node:*` polyfills work, native bindings often don't.
- **Don't exceed the 60 MB image budget without a reason.** This image is intentionally tiny; pulling in a heavy dep can push it past SD-card-friendly sizes.
- **Don't run as a non-root user inside the Pi image.** It needs DBus system bus + network config; `LICENSE` tooling assumes root password `nocturne`.
- **Don't hardcode `nocturne-connector.local` in client code.** Use relative URLs — the UI is served same-origin.

## COMMANDS

```bash
# Build the flashable Pi image (top-level)
just run                # → output/nocturne-connector_<version>.img.gz + .sha256

# Build only the Bun app (no image packaging)
just connector-api      # bun install + tsc check + vite build, in src/

# Lint
just lint               # pre-commit run --all-files

# Cross-arch QEMU helper (registers binfmt for non-arm64 hosts)
just docker-qemu

# Local dev (runs server + Vite together — but won't have BT/DBus on host)
cd src && bun install && bun run dev
```

### Flashing & SSH

- Flash `output/*.img.gz` with Raspberry Pi Imager / balenaEtcher / `dd`.
- Edit `wpa_supplicant.conf` on the SD card root before first boot.
- Visit `http://nocturne-connector.local`. If mDNS doesn't resolve, find the Pi's IP via the router.
- SSH/UART: root password `nocturne`. SSH on port `22` (UART available too — recommended for low-level debug).

## NOTES

- **License is Apache** (per `README.md`), distinct from the GPL-licensed firmware repos. Keep new deps' licenses compatible.
- The image generator originates from `gitlab.com/raspi-alpine/builder` — see `resources/` and `build.sh` for the bridging glue.
- Pi 1, Pi 2, Pi Zero 1 are NOT supported (no onboard Wi-Fi or wrong arch). Documented in README.
- `package.json` in `src/` is the source of truth for the runtime stack. The repo root has no `package.json` — keep it that way; the runtime IS the `src/` subtree.
