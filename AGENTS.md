# Nocturne monorepo — agent guide

Everything that ships inside a Nocturne SWU lives here. The mobile app, Connector, marketing site, OTA distribution server, and HTTP API live in separate repos and are out of scope.

## Layout

| Path | Component | When to touch | Per-component agent guide |
|---|---|---|---|
| `image/` | Yocto / Buildroot recipes for the SWU firmware image (kernel, rootfs, partition layout, OTA recipes). | Anything that changes what's on the disk that isn't the daemon binary or the UI bundle. | (none yet) |
| `crates/daemon/` | The `nocturned` Rust daemon binary. iAP2 / RFCOMM, OTA orchestration, embedded HTTP server, WS to UI. | Daemon code, OTA flow, mobile-app wire protocol. | [`crates/daemon/AGENTS.md`](crates/daemon/AGENTS.md) |
| `crates/shared/` | The canonical wire schema and the codegen consumers (ts-rs + typeshare). | Any wire-protocol change. Refresh bindings with `just codegen`. | (see daemon AGENTS) |
| `crates/iap2/`, `crates/iap2-macros/`, `crates/iap2-mfi/` | iAP2 link/session layer + Identification CSM derive + MFi chip driver. Vendored fork of bridgething's iAP2. | iAP2 protocol changes only. | (see daemon AGENTS) |
| `crates/swupdate-sys/` | Vendored libswupdate IPC client sources (LGPL-2.1-or-later, sbabic/swupdate@2024.12). Built into a static lib by `cc::Build`. | Bumping the vendored swupdate version, or adding extern wrappers in `crates/daemon/src/ota/swupdate/ffi.rs`. | (see daemon AGENTS) |
| `tools/codegen/` | Wire-schema codegen for TS/Swift/Kotlin. Reads `crates/shared/src/`, writes `crates/shared/generated/`. | When you change the inventory of methods/events/markers. | (see daemon AGENTS) |
| `packages/ui/` | The React 19 + Vite kiosk app served by Chromium on the Car Thing (480x800). The static bundle is NOT embedded in the daemon binary; the daemon serves it at runtime from `/opt/nocturne/webapps/ui` (override via `NOCTURNE_WEBAPPS_DIR`), installed onto the rootfs by the `nocturne-ui` image recipe. Deploy a fresh local build to a device with `just -f image/Justfile push-webapp ../packages/ui/dist ui`. | UI work. | [`packages/ui/AGENTS.md`](packages/ui/AGENTS.md) |

## Cross-cutting changes

- **Wire schema change**: edit `crates/shared/src/`, run `just codegen`, then verify the changes propagated to all consumers (the daemon's `crates/daemon/`, the UI's `packages/ui/`, the external [Nocturne Connector](https://github.com/usenocturne/nocturne-connector) if it consumes them, and the external mobile app via released bindings artifacts).
- **Verified phone entitlements**: `app.ready` and `subscription.updated` carry optional `is_admin` and `entitlements_verified` fields. The daemon accepts companion camel case and broadcasts canonical snake case. Phone call and notification presentation fails closed unless entitlements are verified, then accepts either an admin grant or an active Nocturne+ subscription status. Lifetime access alone does not unlock these surfaces.
- **OTA flow change**: the SWU writer (`crates/daemon/src/ota/swupdate/`), the partition layout (`image/`), the manifest format (`crates/daemon/src/ota/manifest.rs`), and the UI's OTA screens (`packages/ui/src/contexts/OTAContext.jsx` and friends) often need to move together. Touch all of them in one PR.
- **Full image restart policy**: a successful image OTA stages the inactive slot and stops after `ota.complete`. `swupdate-progress.service` must run without its reboot flag. The settings UI owns the explicit Restart action, and only that user action boots the staged slot.
- **Hot component activation policy**: successful `daemon` and combined `bandaid` updates stop after `ota.complete` with the promoted payload staged for activation. Only the update UI's explicit Reload action may call `ota.activate`, which schedules a transient `nocturned.service` restart; without that action, the promoted daemon activates on the next reboot. `builtinWebapp` Reload only reloads the kiosk. Keep the explicit activation timer at a three-second monotonic delay with `AccuracySec=100ms`, otherwise systemd's one-minute default timer accuracy can defer the user-requested activation unpredictably.
- **Factory reset policy**: `device.factoryreset` stages a persistent marker, clears paired Bluetooth state, Chromium kiosk state, daemon state, transfers, persisted OTA and macOS connector metadata, and installed webapps, then reboots. Preserve `/var/lib/bandaid/nocturne` and `/var/lib/superbird`; do not call the removed `uenv` utility.
- **OTA version lanes**: update checks retain legacy `from` and also carry exact `image_from` and `bandaid_from` versions. Hot component manifests declare `minimum_image_version`. The OTA server offers a compatible hot update directly, or first routes an old base through an eligible image package. Delta `from_versions` always matches the image lane. Published artifacts use `images/<version>/<kind>/` so image and bandaid releases can share a product version.
- **Writing-phase OTA route recovery**: a matching `ota.begin` from the pinned peer may rebind a replacement companion route while the writer remains active only when kind, size, and hash match. The rebound `ota.package_ready` must not start a second primary pull. For image writes it reactivates the delta broker on the new route and replays the retained in-flight range request; replayed range prefixes are discarded so SWUpdate receives each requested byte once. Different peers, updates, and metadata remain rejected. Apple companions reverify or redownload every cached asset before attempting the rebind.
- **Daemon binary in the image**: `image/` references the daemon via Yocto `EXTERNALSRC`. Bumping the daemon doesn't require a Yocto recipe edit — the image build picks up `crates/daemon/` directly.
- **Login banner metadata**: the image's `/etc/motd` displays `DISTRO_VERSION` and uses the 14-digit `NOCTURNE_BUILD_ID` as its build code. Keep it aligned with the version stamped into image and SWU artifacts.
- **Boot-critical service ordering**: `nocturned.service` intentionally starts without ordering after `bluetooth.service`. The daemon exposes HTTP and WebSocket services while BlueZ and `hci0` initialize, and Bluetooth session creation retries asynchronously with capped backoff. Chromium still probes the local HTTP endpoint before launch. Do not restore a hard Bluetooth ordering dependency or a finite adapter startup deadline.
- **Native phone calls**: iAP2 `CallStateUpdate` messages are merged in `crates/daemon/src/iap2/telephony.rs`; Android companions emit the same complete `phone.call.started`, `phone.call.updated`, and `phone.call.ended` snapshots over SPP. The daemon overwrites companion event `device` with the observed Bluetooth peer. Call requests target the exact active Android SPP route only when its cached `app.ready` peer matches; otherwise they use `iap2:<device>` so native iOS control remains independent from companion `app.ready`.
- **Companion media artwork correlation**: protocol-v2 companions may attach the same optional `media_generation` to `media.now_playing.update` and `media.now_playing.artwork`. The daemon accepts companion camel case and broadcasts canonical snake case. The UI accepts artwork only when both events carry the same generation or both omit it, preserving legacy and native iAP2 media while rejecting stale mixed pairs. When a companion's bound media session dies with no replacement it sends an empty cleared update (no title/artist, `stopped`, fresh generation); the UI clears displayed phone-media/pending items on it but never canonical Spotify. The UI additionally never lets a previous item's artwork outlive a source/track switch beyond a short grace window (`SpotifyImage`), so stale foreign thumbnails cannot ride on Spotify tracks while remote artwork loads.
- **Metadata-only lyrics**: the main Nocturne Now Playing view requests phone media and Spotify local-file lyrics directly from the companion's metadata-only LRCLIB path using only title and artist. Do not resolve these items through Spotify search or require Spotify authentication. Detect local files from either `is_local` or `spotify:local:` and never send their Spotify content id. Every LRCLIB lookup uses only `track_name` and `artist_name` query parameters plus a conventional platform browser user agent without Nocturne branding. Phone track keys still include the complete available metadata for local response correlation, and request generations reject stale lyric responses after a track switch. Phone lyrics remain display-only because phone seeking is unsupported. Do not add this surface to Mockingbird.
- **Phone media progress**: native iAP2 subscriptions include elapsed position, and Android companions emit a current MediaSession position anchor. Both paths use `PlaybackElapsedTimeInMilliseconds` plus normalized `PlaybackRate`; duration uses `MediaItemPlaybackDurationInMilliseconds`, with the UI accepting the legacy native `MediaItemDuration` alias. The main Now Playing screen keeps the bar mounted while a new track's timeline is incomplete, interpolates only known anchors, rejects a briefly stale pause anchor, and keeps phone seeking disabled. Mockingbird other-media presentation intentionally remains without a progress bar.
- **Media feedback controls**: the main UI keeps the heart visible for Spotify local files and phone media. Mockingbird keeps its Spotify heart behavior but uses a spacer for other media. Canonical Spotify uses track ids, local files use their complete `spotify:local:` URI through collection-v2, and main-UI other media uses `media.control.like` and `media.control.unlike`. iOS maps those calls to the two-byte iAP2 Consumer report's Promote and Demote usages; Android uses `MediaController.TransportControls.setRating` only when the focused session advertises `ACTION_SET_RATING`. Source capability never hides the main-UI heart.
- **Wake-word sensitivity**: the daemon requires a per-keyword peak plus supporting scores across three 80 ms inference windows before emitting a candidate. `WAKEWORD_THRESHOLD` controls the peak, `WAKEWORD_SUPPORT_THRESHOLD` controls supporting scores, and `WAKEWORD_PLAYBACK_THRESHOLD` replaces the peak inside the detector while media is playing. A candidate remains globally pending until the main loop pauses the listener after acceptance or explicitly rejects and resets it because no app session is ready. Keep the playback state parser compatible with Pascal case, snake case, and companion camel case attribute names.
- **Mockingbird environment signals**: Night Mode reads the normalized darkness field from `ambient_light_update`, never the opposite-polarity raw ALS value. Air Vent Interference reads daemon `wind_level` events from the shared four-channel microphone capture. Its stock threshold is level 3; disabling alerts suppresses only the banner, while microphone mute suppresses both the banner and icon.
- **AccessorySetupKit pairing**: the first-run QR screen owns the Discoverable and Pairable window until a known phone or `app.ready` session exists. After setup, an explicit Bluetooth device list or Mockingbird Add Phone modal owns it. A shared UI lease coordinator serializes overlapping owners and restores the desired state after WebSocket reconnects. A PIN overlay must not unmount the active owner while iOS bridges the paired LE accessory to classic iAP2. Pairing PIN parsing must ignore null aliases so a legacy `pincode` remains visible when canonical `pin` is null. Treat canonical `bluetooth.pairing` success as visual pairing state only, and treat `bluetooth.connection` with an iAP2 session or `app.ready` as connection readiness. The daemon arms direct iAP2 recovery for newly paired iOS candidates, and the iOS app requests classic transport bridging on every app-initiated CoreBluetooth connection.

## Build / lint commands

From the repo root:

```bash
just daemon-host            # cargo build the daemon for the dev host
just daemon-build           # cross-compile the daemon for aarch64 + --features device
just daemon-copy            # build daemon via Yocto + install to nocturne.local (alias of daemon-deploy)
just ui-dev                 # vite dev server for the device UI
just ui-build               # static bundle the device UI ships with
just image-build            # bitbake the SWU firmware image
just release-image <version-core> <signing-key> [delta-from-versions] [variant] [target] # stamp, build, and publish full/zchunk OTA
just release-bandaid <version-core> <minimum-image-version> [channel] # export bandaid OTA + replaceable bandaid.ext4
just codegen                # regenerate wire-protocol bindings
just test                   # cargo test --workspace
just lint                   # Linux host clippy, non-Linux aarch64 cross clippy, plus cargo fmt --check
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
| `nocturne-connector` | [github.com/usenocturne/nocturne-connector](https://github.com/usenocturne/nocturne-connector) | Standalone Raspberry Pi and macOS companion software; ships independently and does not affect Car Thing firmware. |
| `nocturne-app` | private, separate | iOS + Android distribution, fastlane state, code signing - heavyweight + private. Consumes a versioned bindings artifact published from this monorepo's codegen. |
| `nocturne-site` | private, separate | Marketing site; ships independently to Cloudflare Pages. Does not affect device firmware. |
| `nocturne-api` | private, separate | Cloudflare Workers; ships independently. Remote service the device talks to over HTTPS. |
| `nocturne-ota` | private, separate | OTA distribution server / R2 bucket. Remote service the device fetches SWUs from. |

- **Matching-code pairing**: Car Thing displays the Bluetooth stack's six-digit comparison code; confirmation happens on the peer, with no Car Thing accept/decline buttons or code entry. Windows accepts only authenticated `ConfirmPinMatch`. Legacy PIN/passkey entry fails explicitly instead of using `0000`. Pending display events use an optional `request_id` and the local `bluetooth.pairing.pending` recovery method.
