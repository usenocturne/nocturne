# NOCTURNED - PROJECT KNOWLEDGE BASE

**Generated:** 2026-05-05
**Commit:** d09ad40
**Branch:** main
**Related repos** (separate sibling checkouts; this repo is just the daemon source): `iap2-rs` (consumed via Cargo git dep), `nocturne-ui` (talks to this daemon over WS), `nocturne-app` (mobile companion, talks over BT), `nocturne-image` (Buildroot firmware that bakes this daemon in), `nocturne-ota` (update server), `nocturne-connector` (Pi-side Wi-Fi gateway).

## OVERVIEW

Rust daemon (`nocturned`) running on the Spotify Car Thing (armv7). Talks to iPhone over iAP2/Bluetooth RFCOMM (via the `iap2-rs` library), to the Car Thing UI over WebSocket port 5000, and to the mobile companion app over BT (iAP2 EA on iOS / RFCOMM SPP on Android). This repo is **private** and contains only the daemon source.

## BUILD

Cannot run on host — requires Car Thing hardware (`/dev/apple_mfi`, ALSA `hw:0,0`). Use `cargo check` for validation.

```bash
cargo check                  # Validate (cannot run on host)
just lint                    # cargo clippy --fix --allow-dirty && cargo fmt
just build                   # cross build --target=armv7-unknown-linux-gnueabihf --release
just copy                    # Build + scp binary to Car Thing at 172.16.42.2
```

### Cross-Compilation
- Target: `armv7-unknown-linux-gnueabihf` (Car Thing: arm64 kernel, armv7l userspace)
- Local: `just build` → `cross build --target=armv7-unknown-linux-gnueabihf --release`
- CI: `houseabsolute/actions-rust-cross` with SSH deploy key for private iap2-rs repo
- Pre-build deps: `libdbus-1-dev`, `libopus-dev` (installed via Cross.toml)

## STRUCTURE

```
nocturned/
├── crates/
│   ├── daemon/             # Daemon binary crate (nocturned)
│   ├── shared/             # Shared wire types library
│   │   └── generated/      # Codegen outputs
│   │       ├── ts/
│   │       ├── swift/
│   │       ├── kotlin/
│   │       └── rust/
│   ├── iap2/               # iAP2 protocol stack (package: iap2-rs)
│   ├── iap2-macros/        # Proc macros for iAP2 control-session messages
│   ├── iap2-mfi/           # Apple MFi authentication coprocessor driver
│   └── swupdate-sys/       # SWUpdate FFI bindings
├── tools/
│   └── codegen/            # Schema emitter
├── Cargo.toml              # Workspace manifest
├── Cargo.lock
├── Cross.toml              # ARM cross-compilation config (libdbus-1-dev, libopus-dev pre-installed)
├── Justfile                # Build/lint/deploy commands
├── MFi.md                  # MFi authentication deep-dive (IOCTLs, cert format, challenge-response)
├── resources.zip           # Reverse-engineering artifacts (packet dumps, decompiled stock daemon, MFi spec)
└── target/                 # Cargo build output (gitignored)
```

### Code generation surface

The protocol uses a code generation pipeline to ensure type safety across Rust, TypeScript, Swift, and Kotlin.

- **Canonical schema**: `tools/codegen/src/dispatch/inventory.rs` is the source of truth for all wire types.
- **Emitter modules**: `tools/codegen/src/dispatch/{rust,typescript,swift,kotlin}.rs` produce the target-specific bindings.
- **Output paths**: `crates/shared/generated/{rust,ts,swift,kotlin}/` for shared daemon/app/UI schemas; `crates/iap2/src/csm/generated.rs` for daemon-internal iAP2 CSM structs.
- **Regeneration**:
  - `just codegen`: Writes only into the local `crates/shared/generated/` directory.
  - `just codegen --mirror`: Also writes into mobile app trees at `nocturne-app/ios/Sources/Nocturne/Generated/` and `nocturne-app/android/app/src/main/kotlin/generated/`.
- **Hand-edit policy**: NEVER edit anything under `crates/shared/generated/`, `crates/iap2/src/csm/generated.rs`, or any `generated/` directory in consumer repos. Edit the inventory or emitter instead.
- **Determinism contract**: Emitters MUST be byte-stable. A second `just codegen` invocation must produce zero diffs. CI is expected to enforce this once the codegen track ships.
- **Casing convention**: Wire is `snake_case` (canonical). Emitters convert to `camelCase` for TS/Swift/Kotlin, while `snake_case` is kept in Rust.
- **Cross-link**: See `tools/codegen/src/dispatch/casing.rs` for transforms.

### iAP2 workspace crates

`crates/iap2`, `crates/iap2-macros`, and `crates/iap2-mfi` are now first-class workspace members. They originated as a GPL-3.0-only fork of Joey Eamigh's bridgething iAP2/MFi crates; attribution lives in `ATTRIBUTION.md`. The standalone `iap2-rs` repo is archived at commit `968eea0`, and future iAP2 work happens here alongside the daemon for Tier 1 codegen unification and Tier 2 observability evolution.

**Wire boundaries** (consumers/producers of this daemon's APIs — separate repos, NOT subdirs):

- `crates/iap2` — iAP2 protocol library package (`iap2-rs`) consumed by the daemon through the workspace dependency.
- `nocturne-ui` — Car Thing web frontend. Connects to this daemon over WebSocket port 5000.
- `nocturne-app` — iOS/Android companion. Connects over Bluetooth (iAP2 EA on iOS, RFCOMM SPP on Android), both speaking MsgPack RPC handled by `crates/daemon/src/app/msgpack.rs`.
- `nocturne-image` — Buildroot firmware. Bakes this daemon into the Car Thing rootfs at build time.
- `nocturne-ota` — OTA server. `crates/daemon/src/app/msgpack.rs::download_ota_chunks_task` fetches signed SWU packages from there. Server URL configured in `/etc/nocturne/config.json` (loaded by `crates/daemon/src/system/config.rs`).

## ARCHITECTURE

The daemon follows a layered protocol architecture:

```
main.rs
├── bluetooth/            RFCOMM listener, SDP registration, pairing agent
├── http/                 WebSocket + webapp HTTP servers
├── audio/                Audio capture, Opus encoding, wake word detection
├── hardware/             Brightness, image cache, raw MFi chip driver
├── system/               Config loading and A/B slot helpers
├── app/                  Application layer
│   ├── mod.rs            App communication manager & message types
│   ├── msgpack.rs        MsgPack RPC handler (chunking, CRC32, EA commands)
│   └── websocket_handler.rs  WebSocket→iPhone command routing
├── iap2/                 Bridge to iap2-rs crate + MFi trait provider
├── ota/                  OTA actor, range proxy, slots, swap helpers
└── crates/iap2/          Protocol implementation
    ├── link.rs           Link layer: packet framing, SYN/ACK, sequence numbers
    ├── packet.rs         Binary packet encode/decode, CRC-8 checksums
    ├── auth.rs           MFi certificate authentication
    └── session/          Control, EA, file transfer, now playing, HID sessions
```

### Key Patterns

1. **Async Connection Handling**: Each iPhone connection spawns a separate async task progressing through link negotiation → MFi auth → identification → EA sessions
2. **Stateful Protocol Layers**: Link state machine (Idle → DetectSent → SynSent → Established), auth flow, session management — all in iap2-rs
3. **MsgPack Wire Protocol**: EA sessions use MsgPack RPC with 2000-byte chunking and CRC32 checksums
4. **Dual Transport**: Messages flow over both iAP2 (iOS) and SPP (Android) paths

### Subproject Relationships

```
nocturned (daemon)  ←── iAP2/BT/MsgPack ──→  nocturne-app (mobile, via EA/SPP)
       ↕ WebSocket (port 5000)
nocturne-ui (Car Thing display, served via Chromium kiosk)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Daemon code | `crates/daemon/src/` | Binary crate, 17 modules — see `crates/daemon/src/AGENTS.md` |
| iAP2 protocol internals | `crates/iap2/` | link, packet, session, auth layers in this workspace |
| Car Thing UI internals | `nocturne-ui` repo | Vite+React; WebSocket client to this daemon on port 5000 |
| Mobile-app internals | `nocturne-app` repo | iOS (Swift) + Android (Kotlin) apps; BT client to this daemon |
| MFi auth details | `MFi.md` | IOCTL ops, cert format, challenge-response flow |
| Protocol reference | `resources.zip` (unzip locally — reverse-eng artifacts) | `accessoryd-packets-spotify.txt`, `full_pseudo_c.txt` (`sub_97754` = main) |
| CI pipeline | `.github/workflows/build.yml` | Cross-build for ARM, SSH deploy key for `iap2-rs` |

## CONVENTIONS

### Rust (daemon + iap2-rs)
- Async runtime: `tokio` with full features
- Error handling: `thiserror` for definitions, `anyhow` for propagation in daemon
- Logging: `tracing` — set `RUST_LOG=nocturned=debug,iap2_rs=debug` for protocol traces
- Serialization: `rmp-serde`/`rmpv` for MsgPack wire protocol, `serde_json` for WebSocket/config
- No `lib.rs` in daemon — binary crate only, all modules declared in `main.rs`
- Avoid comments unless genuinely helpful to readers
- Confirm changes will work before submitting — ask for context if unsure

### Frontend (nocturne-ui)
- React 19 + Vite + Tailwind CSS 3
- Formatting: Prettier (`.prettierrc`)
- Package manager: `bun`

### Reference Materials

Unzip `resources.zip` locally (gitignored — too large to track) for reverse-engineering artifacts:

- `dumps/accessoryd-packets-spotify.txt` — actual iAP2 packet captures from stock daemon
- `dumps/full_pseudo_c.txt` — decompiled stock Spotify daemon (`sub_97754` = main)
- `dumps/btsnoop-spotify.txt` — Bluetooth protocol traces
- `docs/mfi-accessory-interface-specification-for-apple-devices.txt` — Apple MFi spec
- `docs/accessory-authentication.png` — MFi auth flowchart

### Protocol Status
- ✅ Bluetooth RFCOMM, iAP2 link negotiation, MFi auth, EA sessions, MsgPack RPC
- ✅ WebSocket server (port 5000), bidirectional UI↔iPhone routing
- ✅ Complete Spotify API command set (27 endpoints), real-time events
- ✅ Audio streaming (16kHz Opus over iAP2 + SPP), wake word detection
- ❌ Media control, app launch (future work)

### Supported Spotify Commands (27 total)
- **Playback**: `spotify.player.{get,play,pause,next,previous,seek,volume,shuffle,repeat}`
- **Library**: `spotify.me.{tracks,playlists,shows,top.artists,top.tracks,recentlyPlayed}`
- **Content**: `spotify.{artist,album,playlist,show}.get`, `spotify.artist.topTracks`, `spotify.show.episodes`
- **Devices**: `spotify.devices`, `spotify.player.transfer`
- **Profile**: `spotify.me.profile`

### Audio Streaming
- **Capture**: `crates/daemon/src/audio/capture.rs` spawns `arecord` (ALSA `hw:0,0`, 16kHz mono S16_LE), Opus encoding (24kbps VBR)
- **Wire Format**: MsgPack events — `audio.recording.started`, `audio.data` (base64 Opus), `audio.recording.stopped`
- **Control**: WebSocket commands `audio.record.start` / `audio.record.stop`

### MFi Hardware
- Certificate from `/dev/apple_mfi` via ioctl `0x80107704`/`0x80107705` in `crates/daemon/src/hardware/mfi_chip.rs`
- Challenge-response: 32-byte challenge → ECDSA P-256 64-byte signature via `0x40107706`/`0x80107707`
- Falls back to hardcoded cert/response on non-Car Thing hardware

## ANTI-PATTERNS (THIS PROJECT)

- **Hardcoded paths are intentional**: `/etc/nocturne/`, `/dev/apple_mfi`, `/dev/misc`, ALSA `hw:0,0` are Car Thing constants — don't refactor into config
- **`iap2-rs` is in-tree**: `Cargo.toml` resolves it from `crates/iap2`; keep daemon+iAP2 protocol evolution atomic inside this workspace.
- **Don't edit other repos from here.** `nocturne-ui`, `nocturne-app`, `nocturne-image`, `nocturne-ota`, `nocturne-connector` each maintain their own conventions — only change them in their respective checkouts.
- **Don't add `lib.rs` to `crates/daemon`**: the daemon binary crate stays binary-only; shared types live in `crates/shared/`
- **Don't change MsgPack chunk format silently**: the iOS app and Android app both expect 36-char UUID message IDs, CRC32 checksums, and 2000-byte chunks — this is part of the public BT wire contract.

## NOTES

- This repo is **private** (closed source for legal reasons).
- The firmware build (`nocturne-image` repo) bakes this daemon into the rootfs via Buildroot. Buildroot fetches the daemon source via `dl/` — local source isn't pulled in from this checkout.
