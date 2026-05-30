# Nocturne monorepo — agent guide

Everything that ships inside a Nocturne SWU lives here. The mobile app, marketing site, OTA distribution server, and HTTP API are external private repos and are out of scope.

## Layout

| Path | Component | When to touch | Per-component agent guide |
|---|---|---|---|
| `image/` | Yocto / Buildroot recipes for the SWU firmware image (kernel, rootfs, partition layout, OTA recipes). | Anything that changes what's on the disk that isn't the daemon binary or the UI bundle. | (none yet) |
| `crates/daemon/` | The `nocturned` Rust daemon binary. iAP2 / RFCOMM, OTA orchestration, embedded HTTP server, WS to UI. | Daemon code, OTA flow, mobile-app wire protocol. | [`crates/daemon/AGENTS.md`](crates/daemon/AGENTS.md) |
| `crates/shared/` | The canonical wire schema and the codegen consumers (ts-rs + typeshare). | Any wire-protocol change. Refresh bindings with `just codegen`. | (see daemon AGENTS) |
| `crates/iap2/`, `crates/iap2-macros/`, `crates/iap2-mfi/` | iAP2 link/session layer + Identification CSM derive + MFi chip driver. Vendored fork of bridgething's iAP2. | iAP2 protocol changes only. | (see daemon AGENTS) |
| `crates/swupdate-sys/` | Vendored libswupdate IPC client sources (LGPL-2.1-or-later, sbabic/swupdate@2024.12). Built into a static lib by `cc::Build`. | Bumping the vendored swupdate version, or adding extern wrappers in `crates/daemon/src/ota/swupdate/ffi.rs`. | (see daemon AGENTS) |
| `tools/codegen/` | Wire-schema codegen for TS/Swift/Kotlin. Reads `crates/shared/src/`, writes `crates/shared/generated/`. | When you change the inventory of methods/events/markers. | (see daemon AGENTS) |
| `packages/ui/` | The React 19 + Vite kiosk app served by Chromium on the Car Thing (480x800). The static bundle is embedded in the daemon binary at build time. | UI work. | [`packages/ui/AGENTS.md`](packages/ui/AGENTS.md) |
| `packages/connector/` | Raspberry Pi OS image that bridges Wi-Fi to the Car Thing. Bun + Elysia server + Vite + React setup UI. Standalone hardware. | Connector work; does not affect what's on the Car Thing itself. | [`packages/connector/AGENTS.md`](packages/connector/AGENTS.md) |

## Cross-cutting changes

- **Wire schema change**: edit `crates/shared/src/`, run `just codegen`, then verify the changes propagated to all consumers (the daemon's `crates/daemon/`, the UI's `packages/ui/`, the connector if it consumes them, and the external mobile app via released bindings artifacts).
- **OTA flow change**: the SWU writer (`crates/daemon/src/ota/swupdate/`), the partition layout (`image/`), the manifest format (`crates/daemon/src/ota/manifest.rs`), and the UI's OTA screens (`packages/ui/src/contexts/OTAContext.jsx` and friends) often need to move together. Touch all of them in one PR.
- **Daemon binary in the image**: `image/` references the daemon via Yocto `EXTERNALSRC`. Bumping the daemon doesn't require a Yocto recipe edit — the image build picks up `crates/daemon/` directly.

## Build / lint commands

From the repo root:

```bash
just daemon-host            # cargo build the daemon for the dev host
just daemon-build           # cross-compile the daemon for aarch64 + --features device
just daemon-copy            # daemon-build + scp to 172.16.42.2
just ui-dev                 # vite dev server for the device UI
just ui-build               # static bundle the device UI ships with
just connector-dev          # vite dev for the connector setup UI
just image-build            # bitbake the SWU firmware image
just codegen                # regenerate wire-protocol bindings
just test                   # cargo test --workspace
just lint                   # cargo clippy --workspace -- -D warnings + cargo fmt --check
```

## Conventions

- **No type suppression** anywhere: never `as any`, `@ts-ignore`, `@ts-expect-error`, or Rust `#[allow(dead_code)]` to silence real issues.
- **No empty catch blocks**: always handle or log.
- **No shotgun debugging**: fix root causes, not symptoms.
- **Generated files are never hand-edited**: `crates/shared/generated/**` is `just codegen` output. If output is wrong, fix the source in `crates/shared/src/` or the emitter in `tools/codegen/`.
- **Bun over Node**: TS packages use `bun install`, `bun run`, `bunx`.
- **No emdashes or endashes** in prose for files I (the agent) author.
- **Keep per-component AGENTS.md up to date** when you change a component.

## What's not here

| Repo | Where | Why it stays out |
|---|---|---|
| `nocturne-app` | private, separate | iOS + Android distribution, fastlane state, code signing - heavyweight + private. Consumes a versioned bindings artifact published from this monorepo's codegen. |
| `nocturne-site` | private, separate | Marketing site; ships independently to Cloudflare Pages. Does not affect device firmware. |
| `nocturne-api` | private, separate | Cloudflare Workers; ships independently. Remote service the device talks to over HTTPS. |
| `nocturne-ota` | private, separate | OTA distribution server / R2 bucket. Remote service the device fetches SWUs from. |
