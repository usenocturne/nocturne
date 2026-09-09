# NOCTURNED - PROJECT KNOWLEDGE BASE

This guide covers `crates/daemon` inside the Nocturne monorepo. See the root `AGENTS.md` for component boundaries and cross-component policies.

## OVERVIEW

Rust daemon (`nocturned`) running on the Spotify Car Thing (aarch64). Talks to iPhone over iAP2/Bluetooth RFCOMM (via the `iap2-rs` library), to the Car Thing UI over WebSocket port 5000, and to the mobile companion app over BT (iAP2 EA on iOS / RFCOMM SPP on Android). The daemon, UI, image recipes, shared schema, and iAP2 implementation live in this monorepo.

## BUILD

Full runtime validation requires Car Thing hardware (MFi coprocessor on `/dev/i2c-3`, ALSA `hw:0,0`). Native builds and tests require Linux because BlueZ imports Linux-only APIs; the `daemon-host` recipe does not make these dependencies portable to macOS. On macOS use the documented cross target and container runtime.

```bash
cargo check -p nocturned      # Linux host validation
cargo test -p nocturned       # Linux host tests
cross test -p nocturned --target=aarch64-unknown-linux-gnu --features device
just lint                    # Linux clippy or non-Linux cross clippy, then cargo fmt --check
just daemon-build            # cross build --target=aarch64-unknown-linux-gnu --release --features device
just daemon-copy             # build daemon via Yocto + install to nocturne.local
```

Release builds use LTO, strip symbols, and abort on panic. Systemd restarts the
daemon after a crash, so do not introduce panic-recovery code that requires
stack unwinding without revisiting this profile.

### Cross-Compilation
- Target: `aarch64-unknown-linux-gnu` (Car Thing: arm64 kernel + aarch64 userspace)
- Local: `just daemon-build` → `cross build --target=aarch64-unknown-linux-gnu --release --features device`
- Pre-build deps: `libdbus-1-dev`, `libopus-dev` (installed via Cross.toml)

## STRUCTURE

```
nocturne/
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

- **Canonical schema**: `crates/shared/src/` defines the wire types. `tools/codegen/src/dispatch/inventory.rs` inventories methods and events for dispatch generation.
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

The production accessory link proposal uses a 32-packet send window and 4096-byte maximum link frame, with a 16 KiB receive buffer so one read can batch at least four maximum frames. Keep these values aligned when tuning transport throughput. The established loop honors the peer `max_ack` threshold and ACK-delay timer, which hardware A/B testing found materially faster than immediate standalone ACKs for OTA traffic. The daemon logs the peer's negotiated LSP fields when the link becomes established so device tests can verify the effective limits rather than infer them from the accessory proposal.

**Wire boundaries** (consumers and producers of this daemon's APIs):

- `crates/iap2` — iAP2 protocol library package (`iap2-rs`) consumed by the daemon through the workspace dependency.
- `packages/ui` in this monorepo is the Car Thing web frontend. It connects to this daemon over WebSocket port 5000.
- `nocturne-app` — iOS/Android companion. Connects over Bluetooth (iAP2 EA on iOS, RFCOMM SPP on Android), both speaking MsgPack RPC handled by `crates/daemon/src/app/msgpack.rs`.
- `nocturne-connector` macOS companion: after a fresh pairing and on an explicit UI connect for a computer-class device, `crates/daemon/src/bluetooth/mod.rs` sends a short RFCOMM probe to the Mac's Bluetooth-Incoming-Port listener on channel `3`. Classification is shared with the WebSocket device inventory and primarily uses the standard BlueZ computer icon or Bluetooth major class, so custom host names do not affect routing; recognizable Mac names are fallback metadata only. A successful channel-3 probe persists the canonical peer address in `/var/lib/nocturne/known-macos-connectors.json`, making later routing independent of all display metadata until that peer is unpaired. Fresh-pair probes retry with capped backoff because the Mac listener may become available just after bonding. The Mac responds by dialing this daemon's SPP/RPC channel `2`. Keep this Car Thing-triggered; the Mac must not poll or sweep the Car Thing address.
- Raspberry Pi connectors identify `app.ready.platform` as `web`. At the final UI-to-companion boundary, keep canonical snake-case Spotify methods for native apps, but translate the six historical camel-case method names back for `web` companions. Released connector v2 builds require those names, so do not remove the adapter without an explicit compatibility cutoff.
- Mockingbird artist tracklists send `mockingbird: true` with `spotify.artist.top_tracks`. Keep that optional field in the generated request schema because canonical request normalization reserializes typed payloads, and companion implementations use the flag to include album subtitles and artwork.
- Companion ownership is connection-scoped. Each `app.ready` snapshot is stored with the exact iAP2 or SPP route that emitted it; the most recently ready route owns UI RPCs and events. Every WebSocket request must target only that route, never broadcast to all connected companions. When the owner closes, promote the most recently ready surviving route and replay its `app.ready` snapshot so method adaptation and UI state change together.
- Generic SPP peers can briefly create overlapping channels during reconnect. Each channel has its own connection identity; a stale channel closing must remove only itself and must not clear cached `app.ready` while another channel for that peer remains active.
- `app.ready` and `subscription.updated` entitlement fields are normalized from companion camel case to canonical snake case before WebSocket broadcast. Preserve optional `is_admin` and `entitlements_verified` through normalization and cached `app.ready` replay. Missing fields remain missing so UI consumers can fail closed with older or unverified companions.
- Companion media updates and artwork may include optional `media_generation`. Normalize both camel case and snake case to canonical snake case without inventing a generation for legacy companions or native iAP2. A matching pair lets the UI reject cached artwork from an older media snapshot.
- `image/` contains Yocto firmware recipes. The daemon recipe builds this workspace through `EXTERNALSRC`.
- `nocturne-ota` — OTA server. `crates/daemon/src/app/msgpack.rs::download_ota_chunks_task` fetches signed SWU packages from there. Server URL configured in `/etc/nocturne/config.json` (loaded by `crates/daemon/src/system/config.rs`).

## ARCHITECTURE

Delta range progress reporting must never await space in the broker mailbox: the broker may already be waiting for the reporting consumer to drain its bounded chunk queue. Drop an intermediate progress update under saturation while preserving all payload chunks and terminal OTA events.

The daemon follows a layered protocol architecture:

```
main.rs
├── bluetooth/            RFCOMM listener, SDP registration, pairing agent
├── http/                 WebSocket + webapp HTTP servers
├── audio/                Audio capture, Opus encoding, wake word and wind detection
├── hardware/             Brightness, image cache, raw MFi chip driver
├── system/               Config loading and A/B slot helpers
├── app/                  Application layer
│   ├── mod.rs            App communication manager & message types
│   ├── msgpack.rs        MsgPack RPC handler (chunking, CRC32, EA commands)
│   └── websocket_handler.rs  WebSocket→iPhone command routing
├── iap2/                 Bridge to iap2-rs crate + MFi trait provider
├── ota/                  OTA actor, delta source, slots, swap helpers
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
5. **Boot Confirmation**: The Yocto image uses U-Boot env slot keys (`slot_active`, `slot_a_tries`, `slot_b_tries`). `reset_boot_counter` must use `ota::slots`/`fw_setenv` and must not shell out to the old `phb` helper.
6. **iOS Notifications**: `bluetooth/ancs.rs` subscribes to ANCS over the paired iPhone LE link and forwards typed show/remove events to the UI. An explicit iAP2 session owns selection when present. Without iAP2, the daemon may subscribe autonomously only when exactly one paired, connected ANCS-capable iPhone exists; ambiguous multi-phone state must wait for explicit ownership. The AccessorySetupKit advertisement is normally withdrawn while an LE ACL is active and restored after disconnect so the legacy controller cannot retain a stale advertising instance across ANCS reconnects. Explicit classic discoverability is the exception: the advertisement remains available so Android can pair from the Car Thing Bluetooth screen while an iPhone is connected. ANCS sessions also watch BlueZ device removal because a fast reconnect can disappear between controller probes while invalidating every old GATT object.
7. **iPhone Address Identity**: A bonded iPhone's BlueZ object path may retain its private address while `Device1.Address` changes to the stable identity. Resolve both forms to the live object and use the stable identity for iAP2 ownership, recent pairing timestamps, UI events, and reconnect keys. Both the initial paired snapshot and later `Paired` property changes use one state handler, so a pairing event that races monitor startup still arms direct iAP2 recovery. Incomplete BlueZ metadata is retried without dialing an unclassified peer. A running recovery task promotes its timestamp, deduplication key, and RFCOMM target when the private address resolves to the stable identity. Recovery uses RFCOMM channel 1 with 2s to 30s backoff, but never arms or continues for a device whose BlueZ `Blocked` property is true. Android and macOS peers remain outside this path.
8. **Native Phone Calls**: The iAP2 session advertises and subscribes to native telephony CSMs. `crates/daemon/src/iap2/telephony.rs` merges sparse call deltas per connection. Android companions emit the same complete lifecycle snapshots over SPP, and `app/msgpack.rs` replaces their `device` with the daemon-observed peer. Accept, decline, and snapshot requests target the exact active Android SPP route when its cached `app.ready` peer matches. All other requests route to `iap2:<device>`, preserving native iOS control without a companion app.
9. **Native Phone Media Timing**: The iAP2 Now Playing subscription requests elapsed position. Merge sparse position and playback-speed updates with retained metadata, clear stale timing on track changes, and broadcast `MediaItemPlaybackDurationInMilliseconds`, `PlaybackElapsedTimeInMilliseconds`, and multiplier-form `PlaybackRate`. Preserve `MediaItemDuration` as a compatibility alias. Phone media progress is display-only unless a separate user-action seek path is implemented and protocol-gated.
10. **Explicit Pairing Window**: Adapter startup pins classic discoverable and pairable timeouts to zero but starts with both properties disabled unless an early UI request has already opened the pairing window. Bluetooth initialization restores that requested state under the same transition lock so it cannot overwrite the first-run QR lease. The `bluetooth.discoverable` RPC serializes changes to both properties, rolls back a partial open, and attempts both close operations so failures do not silently leave pairing open. The UI opens that window on the first-run QR screen until a known phone or `app.ready` session exists. After setup, an explicit Bluetooth device list or Mockingbird Add Phone modal owns it. Incoming SPP is accepted only from an already-paired peer or the exact peer covered by a short-lived explicit Android wake grant.
11. **Boot-Parallel Bluetooth**: `nocturned.service` wants BlueZ but does not order after it. HTTP and WebSocket tasks become available while Bluetooth initialization recreates the BlueZ session and retries adapter configuration indefinitely with 250 ms to 5 s capped backoff. D-Bus ownership races and other initialization failures must not terminate the daemon or trigger image rollback.
12. **Resumable OTA Ownership**: OTA partials, metadata, and the active manifest survive daemon restarts and transient companion route loss. The peer remains pinned across recovery, while a new `ota.begin` from that same peer may bind the replacement iAP2 or SPP route and resume from the on-disk byte count. The installer kind and authorized target version are immutable for an update ID. A companion may repeat a stale `ota.package_ready` resume offset after reconnect, so the actor must return and use the current durable on-disk offset. Pull window size is renegotiated from the current companion on each compatible `ota.package_ready`, allowing an upgraded companion to increase throughput without changing the durable offset or artifact identity. Cap a compatible pull window at 256 KiB. MessagePack receive and reassembly limits are 512 KiB, including the aggregate pending-message payload cap, so a full binary or base64-compatible response fits while one sequential request remains in flight. Every chunk, progress update, cancellation, and delta response must match the active source; outbound delta range requests and abandons target the exact connection route as well as its peer. Writing is non-cancellable once started, and background write results must include both update ID and write ID so stale tasks cannot advance current state. A delta range that receives no chunk for 60 seconds must fail and unwind rather than pinning the actor forever. Image target selection uses `superbird.slot` from the running kernel command line, not U-Boot's next-boot `slot_active`, because SWUpdate changes the latter before reboot. The daemon rejects reinstall and downgrade targets before transfer, using SemVer core and prerelease ordering followed by the numeric `+build` timestamp as Nocturne's tie-break. Image targets are compared with the exact running rootfs image version; daemon, builtin webapp, and bandaid targets are compared with the active bandaid version. Recovery applies the same kind-specific policy. Successful writes remove the transfer payload, metadata, and persisted manifest before broadcasting `ota.complete`, so an explicit activation or image restart cannot race cleanup. Successful daemon, builtin webapp, and bandaid promotions atomically replace `/var/lib/bandaid/nocturne/.floor-version`; device version responses expose the rootfs image and active bandaid versions separately while preserving the effective legacy version. Completion never restarts the daemon. The update UI's explicit `ota.activate` request schedules a three-second transient systemd unit for staged daemon and combined bandaid payloads; otherwise they activate on the next reboot. The timer must set `AccuracySec=100ms`; systemd's one-minute default accuracy otherwise makes the requested activation delay unpredictable. Builtin webapp Reload does not restart the daemon.
13. **Writing-phase OTA Route Recovery**: A matching `ota.begin` from the pinned peer may rebind a replacement companion route while the writer remains active only when kind, size, and hash match. The rebound `ota.package_ready` must not start a second primary pull. For image writes it reactivates the delta broker on the new route and replays the retained in-flight range request; replayed range prefixes are discarded so SWUpdate receives each requested byte once. Different peers, updates, and metadata remain rejected. Apple companions reverify or redownload every cached asset before attempting the rebind.
14. **Ambient and Wind Signals**: `ambient_light_update` emits the raw ALS value plus the stock-compatible normalized darkness value once per second after an 11-sample median. Mockingbird must consume only the normalized value. The four-channel 48 kHz capture path also measures low-frequency spatially incoherent turbulence and emits `wind_level` with levels 0 through 4. Level 3 is the stock UI alert threshold. The continuous wake-word reader exclusively owns wind analysis. Dedicated voice fallback never feeds an independent wind stream, including when the listener recovers during recording. Wind updates pause while the wake reader is unavailable; shared recording must never feed historical pre-roll into wind analysis a second time.
15. **Factory Reset**: `device.factoryreset` stages `/var/lib/nocturne/factory-reset.pending`, clears paired Bluetooth state, Chromium kiosk state, daemon state, transfers, persisted OTA and macOS connector state, and installed webapps, then reboots. Preserve `/var/lib/bandaid/nocturne` and `/var/lib/superbird`. The runtime path must not call the removed `uenv` utility. The image helper consumes the marker before daemon startup as a retry-safe fallback.

### Subproject Relationships

```
nocturned (daemon)  ←── iAP2/BT/MsgPack ──→  nocturne-app (mobile, via EA/SPP)
       ↕ WebSocket (port 5000)
nocturne-ui (Car Thing display, served via Chromium kiosk)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Daemon code | `crates/daemon/src/` | Binary crate; see `crates/daemon/src/AGENTS.md` |
| iAP2 protocol internals | `crates/iap2/` | link, packet, session, auth layers in this workspace |
| Car Thing UI internals | `packages/ui/` | Vite+React; WebSocket client to this daemon on port 5000 |
| Mobile-app internals | `nocturne-app` repo | iOS (Swift) + Android (Kotlin) apps; BT client to this daemon |
| iPhone notifications | `crates/daemon/src/bluetooth/ancs.rs` | ANCS discovery, subscription, attribute parsing, app display names, and UI event lifecycle |
| MFi auth details | `MFi.md` | IOCTL ops, cert format, challenge-response flow |
| Protocol reference | `resources.zip` (unzip locally — reverse-eng artifacts) | `accessoryd-packets-spotify.txt`, `full_pseudo_c.txt` (`sub_97754` = main) |
| CI pipeline | `.github/workflows/` | Workspace build and verification workflows |

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
- Media controls and companion app launch are implemented in `app/hid_mapping.rs` and `iap2/mod.rs`.

### Supported Spotify Commands (27 total)
- **Playback**: `spotify.player.{get,play,pause,next,previous,seek,volume,shuffle,repeat}`
- **Library**: `spotify.me.{tracks,playlists,shows,top.artists,top.tracks,recentlyPlayed}`
- **Content**: `spotify.{artist,album,playlist,show}.get`, `spotify.artist.topTracks`, `spotify.show.episodes`
- **Devices**: `spotify.devices`, `spotify.player.transfer`
- **Profile**: `spotify.me.profile`

### Audio Streaming
- **Capture**: `crates/daemon/src/audio/capture.rs` routes TODDR_A/B to PDM `IN 4`, normally shares the wake-word reader on ALSA `hw:0,0` as 48kHz 4-channel S32_LE; `hw:0,1` is a dedicated fallback only when the continuous source is unavailable, converts to 16kHz mono S16_LE, then Opus encodes (24kbps VBR). Raw frames reach wind detection through a bounded batch worker so its floating-point analysis cannot stall wake-word capture and create ALSA overruns.
- **Noise suppression metadata**: `audio.recording.started` carries optional `noise_suppressed: true` for this daemon's Sonora-processed voice stream. Android skips its extra pass only when this flag is true; absent or false preserves legacy processing. Keep this marker aligned with actual capture processing and generate the shared bindings from the canonical inventory.
- **Wire Format**: MsgPack events — `audio.recording.started`, `audio.data` (base64 Opus), `audio.recording.stopped`
- **Control**: WebSocket commands `audio.record.start` / `audio.record.stop`
- **Silence detection**: Initial grace starts on the first captured PCM frame, not task spawn time, so ALSA startup latency cannot eat the grace window and clip the end of voice commands.
- **Cancel**: `voice.cancel` also stops daemon audio capture before it is forwarded to the phone app. Phone apps treat stopped/cancelled/user_cancelled stop reasons as no-upload cancellation and release AI/TTS/ducking immediately.
- **Continuous voice input**: Subscribe to the same frame-aligned raw stream as the wake listener using an atomic pre-roll snapshot and live subscription. Never splice the end of one ALSA stream onto the buffered beginning of another. Shared chunks are bounded and stream resets, lag or two-second stalls cancel the recording. Wake-reader EOF and read errors invalidate the shared stream immediately, before process cleanup or restart waits. Dedicated capture has no independent pre-roll and also stops on a two-second input stall. Consume pre-roll incrementally so each Opus frame receives the VAD evidence for its own samples.
- **Experimental voice frontend priming**: Enable only with explicit diagnostic `NOCTURNE_AUDIO_PRIME=1`; it is off by default. Without that exact opt-in, capture uses the original unprimed atomic `subscribe_since` path and discards zero PCM frames. This experimental policy is not validated for deployment. The raw history ring retains at most 3.3 seconds (2,534,400 bytes) without continuous RNNoise processing. A voice-only atomic subscription includes up to three seconds older than the existing 300 ms output margin. Capture runs those samples through both its Sonora output converter and RNNoise endpoint sidechain and discards whole 60 ms PCM frames before emitting Started/Data or starting endpoint timers, clearing VAD evidence for every discarded frame. Floor the discard count so the requested pre-roll is never shortened; output can include less than one additional 60 ms frame at that boundary. Existing journal pre-roll observations were 318 to 375 ms due to raw chunk timing, not a 600 ms configured margin. Dedicated fallback has no priming history. Yield to Tokio after every discarded 60 ms PCM frame so draining ready history cannot monopolize an async worker across the entire priming window; synchronous conversion within each frame remains a bounded CPU section and still needs measurement. Priming adds startup compute cost and changes warmed DSP/VAD state; do not claim unchanged wall-clock endpointing or live performance without measurement. The unprimed subscription remains the production default. Raw retention is still bounded at 3.3 seconds even when priming is disabled; this adds bounded history memory, not continuous RNNoise compute.
- **XRUN integrity**: Both wake and dedicated recorders use `arecord --fatal-errors`, supported by the installed device binary. An ALSA overrun must terminate the recorder rather than resume with an unmarked sample gap. Wake-reader EOF/read failure immediately invalidates shared history and cancels dependent recording through the existing generation guard; dedicated EOF is a cancelled capture failure. Do not revert to silent arecord XRUN recovery or claim a failed partial recording as complete. Keep the exact argument regression for both hardware sources.
- **Capture failure cleanup**: Observe recording task completion directly, including abnormal task exits, so a failed task cannot pin capture active. Every returned capture error reaps its recorder and emits one `audio.recording.stopped` with the existing `cancelled` reason; keep the diagnostic cause in daemon logs. This resumes wake-word listening and prevents companions from transcribing a truncated failed recording. An unexpected dedicated-recorder EOF is also a capture error, even after frames were encoded; never publish it as a successful partial recording. Keep injected encoding-failure, finite-child EOF, process-reaping, and restart regressions in `audio/capture.rs`.
- **Saved-file capture validation and benchmark**: Run a matching test binary with `NOCTURNE_AB_INPUT=/tmp/generated-mic.raw <test-binary> audio::capture::tests::benchmark_recorded_capture_sidechain_and_opus --exact --ignored --nocapture`. It reads at most 30 seconds of saved four-channel 48 kHz S32_LE, runs the actual production Sonora capture converter against the original RNNoise baseline once each, and asserts exact endpoint PCM/VAD plus nonempty Opus packets decoding to 960 samples. Optional `NOCTURNE_AB_OUTPUT` saves the concatenated production pre-Opus PCM to a new file only; an existing path is rejected so input fixtures cannot be overwritten. Timing repeats default to zero; explicitly set `NOCTURNE_AB_REPEATS=5` for five alternating repeats per variant (accepted range 0 through 5). Report cumulative conversion/encoding cost and maximum accumulated processing per 60 ms frame separately from wall-clock latency; emulation does not prove device scheduling or real-time guarantees. The test never opens a microphone or modifies its input.
- **Opt-in PCM diagnosis**: `NOCTURNE_AUDIO_TRACE_DIR` enables local post-DSP, pre-Opus traces for controlled diagnosis. It is off by default. A trace retains only successfully encoded frames, at most 30 seconds, and writes owner-only PCM plus metadata after capture stops. One capture or writer may hold the trace buffer at a time, so slow storage never accumulates unbounded speech. Use temporary storage, disable the environment setting after diagnosis, and do not upload raw traces.
- **Opt-in exact raw capture diagnosis**: `NOCTURNE_AUDIO_TRACE_RAW=1` additionally records the exact raw chunks consumed before conversion, including shared priming history, pre-roll and conversion lookahead, only while the existing `NOCTURNE_AUDIO_TRACE_DIR` capture/writer permit is held. It is off by default and never changes output or endpoint policy. A same-stem owner-only `.s32le` contains at most 23,040,000 bytes (30 seconds, four-channel 48 kHz S32_LE), rounded down to complete 16-byte frames. JSON `raw` metadata states source, pre-DSP stage, consumed/retained counts, partial-frame discard, truncation, planned priming frames and actually discarded PCM frames/samples; these bytes are not limited to successfully encoded audio and are not automatically the exact command interval. Replay the entire raw prefix through the normal converter, then skip the metadata's actually discarded PCM samples to align with transmitted audio. Discarded priming frames never reach Opus or the PCM trace. A raw trace's 30-second cap includes priming context, so it may cover less than 30 seconds of encoded audio. Raw and PCM share one writer permit, with asynchronous bounded-chunk file writes after terminal capture cleanup. Disable both diagnostic settings after use; retain raw locally and never upload it without explicit authorization.
- **Recording resume history**: Transient recording suppression keeps the mel and embedding windows current while skipping classification. Clear candidate and score evidence at pause, but discard feature history only for user mute or a capture restart. This avoids a two-second detection blind interval after recording. Audio debug logging reports bounded confidence and PCM RMS peaks every 16 classified windows, without recording speech.
- **Opt-in wake score trace**: Enable only `nocturned::audio::wakeword::scores=trace` within `RUST_LOG` for bounded diagnostic cohorts. Release dependencies retain trace callsites; ordinary debug/info logging is unchanged. Each classification logs its shared window index, classifier order, capture sequence, processed 16 kHz sample position, elapsed monotonic milliseconds, score, actual gate-window peak/support count, configured normal/playback peaks, playback flag and pending/confirmed state. No waveform or transcript is added. Capture sequence/sample position restart when arecord restarts; the window index spans the detector run. Classification is skipped during recording suppression and stops the current classifier loop after an accepted candidate, so missing rows are not zero scores. For same-score threshold comparisons, select the first eligible row per trial and policy using `candidate_pending=false`, `supporting_frames>=required_frames` and the logged `window_peak` against the chosen logged peak; check pre-speech candidates first. Do not count overlapping passing windows as separate activations or infer post-candidate behavior from censored scores. Align trials using journal timestamps; processed sample position is not an acoustic timestamp. Four classifiers produce at most roughly 50 trace rows per second; measure diagnostic overhead and remove this filter after use.
- **Wake-word noise suppression**: Only when explicitly enabled, the wake-only 16 kHz mono frontend passes through `sonora-ns` 0.2 at explicit 12 dB suppression in persistent 160-sample blocks before mel extraction. Float samples use PCM16 magnitude, with PCM16 rounding preserved from the recorded-input evaluation. Its overlap adds 96 samples (6 ms) of delay. Continue processing during transient recording suppression so both noise and model history remain warm; reset suppression with the converter on microphone mute or recorder restart. Raw shared pre-roll and wind analysis remain separate from this stage. Recording has its own Sonora state and RNNoise endpoint sidechain; the wake rollback flag does not disable recording suppression. Wake suppression is disabled by default: only `WAKEWORD_NOISE_SUPPRESSION=1` enables it; unset or `0` disables it, and invalid values warn and remain disabled. The selected new wake models performed better overall on the saved music/wind inputs without this stage; this decision does not change recording suppression or the score gate. The daemon now requires Rust 1.91; other workspace crates keep their declared minimum. Local Linux ARM64/Cortex-A53 emulation establishes functional compatibility, not actual device CPU or acoustic performance.
- **Wake-word guard**: wake-word capture requires the cached `app.ready` handshake from the current phone session before starting audio; `app.ready` is only sent at connection handshake, not per voice turn. ONNX parsing and optimization run through Tokio's bounded-work blocking pool so they cannot stall async HTTP, WebSocket, or Bluetooth tasks. The default decision policy requires one score of at least `WAKEWORD_THRESHOLD` (`0.65`) with both consecutive scores at least `WAKEWORD_SUPPORT_THRESHOLD` (`0.50`) across the same classifier's two 80 ms windows. Only one candidate may be pending globally. The main loop must either pause after acceptance or send `RejectDetection` after an app-ready rejection. While `media.now_playing.update` says playback is active, the detector substitutes `WAKEWORD_PLAYBACK_THRESHOLD` (default: the normal peak, `0.65`) for the normal peak threshold before it emits a candidate. Thresholds must be finite and in `(0, 1]`; the playback threshold is never allowed below the activation threshold. Keep this behavior coordinated with Android's CompanionDevice wake path.

### MFi Hardware
- Userspace i2c via the in-tree `iap2-mfi` crate: `iap2_rs::MfiAuth::open_default()` opens the coprocessor on `/dev/i2c-3` @ `0x10` (matches bridgething), driven on a dedicated thread by `iap2_rs::WorkerMfiAccess` (wired in `crates/daemon/src/iap2/mod.rs`)
- Certificate read + challenge-response (32-byte challenge → 64-byte ECDSA P-256 signature) happen inside the chip; the daemon just drives the i2c command set
- No kernel driver / `/dev/apple_mfi`; no host fallback — iAP2 only works on real Car Thing silicon

### Display Sleep
- UI lock/sleep uses WebSocket methods `device.display.get`, `device.display.sleep`, and `device.display.wake`; this is a daemon-local UI contract, not part of the phone MsgPack protocol.
- Display sleep is transient and separate from entering the UI lock screen. `crates/daemon/src/hardware/brightness.rs` stores the current saved brightness/auto config in memory, stops native auto brightness, writes the dimmest backlight value, and restores the saved manual value or restarts auto brightness on wake.
- Do not use `device.brightness.set` for sleep: that command intentionally persists a manual brightness value and disables auto brightness.
- Automatic brightness uses the calibrated TMD2772 settings from Bridgething: gain `16`, 100 ms integration, 200 ms sensor sampling, and an 11-sample median window. The raw sensor range above the dark knee is normalized before applying a square-root response, which keeps dark-room readings near the physical backlight floor of `16` without sacrificing the daylight range. Backlight movement uses Nocturne's smaller fixed 2% steps every 40 ms and change-only sysfs writes. Physical value `0` remains reserved for transient display sleep.

## ANTI-PATTERNS (THIS PROJECT)

- **Hardcoded paths are intentional**: `/etc/nocturne/`, `/etc/superbird`, `/dev/i2c-3` (MFi @ `0x10`), `/dev/misc`, ALSA `hw:0,0`, Amlogic TODDR_A/B `IN 4`, and efuse nvmem cells under `/sys/bus/nvmem/devices/efuse0/cells/` are Car Thing constants - don't refactor into config
- **`iap2-rs` is in-tree**: `Cargo.toml` resolves it from `crates/iap2`; keep daemon+iAP2 protocol evolution atomic inside this workspace.
- External mobile, Connector, and OTA repositories maintain their own conventions. UI and firmware changes belong in this monorepo under `packages/ui/` and `image/`.
- **Don't add `lib.rs` to `crates/daemon`**: the daemon binary crate stays binary-only; shared types live in `crates/shared/`
- **Don't change MsgPack chunk format silently**: the iOS app and Android app both expect 36-char UUID message IDs, CRC32 checksums, and 2000-byte chunks — this is part of the public BT wire contract.

## NOTES

- The workspace license is GPL-3.0-only. The Yocto image recipe builds the daemon from this checkout through `EXTERNALSRC`.
- Artwork cache reads perform the asynchronous read directly and treat `NotFound` as a cache miss. Keep existing Spotify locale-based cache filenames compatible; do not add a synchronous existence probe ahead of each read.

### Matching-code Bluetooth pairing

The Car Thing advertises `DisplayYesNo` and displays the stack-generated six-digit comparison code. The peer owns user confirmation; neither Car Thing UI skin shows acceptance or rejection buttons. Never restore fixed PIN/passkey responses, PIN entry, or a legacy fallback: legacy PIN and passkey-entry callbacks are rejected. The Windows Connector requires authenticated numeric comparison. Pending display events carry `request_id`, recover through the local `bluetooth.pairing.pending` method, and clear on matching-device completion, disconnection/removal, cancellation, release, or timeout. Do not log pairing codes or clear a new display from an old unpaired snapshot.

### Slow WebSocket clients

Each UI connection has a 64-message FIFO. A full or closed queue disconnects that client instead of dropping individual messages or blocking other clients. Socket writes time out after five seconds; queue-overflow cancellation also interrupts a stalled write. Preserve ordering for clients that remain connected and keep overflow recovery explicit through a fresh connection. OTA transfer cleanup scans once immediately at startup, then once every 24 hours.

Outbound MessagePack chunk creation rejects messages requiring more than 1,000 chunks before constructing or sending any envelope. Register pending RPCs only after serialization and chunk-bound validation succeed so rejected payloads cannot leak pending entries.

Accepted companion abandonment before writing clears transfer state, then emits one terminal `ota.error` with code `cancelled` and the update ID in its message. Duplicate, unknown, or stale-source abandonment must not terminate another transfer; writing retains its existing non-cancellable rejection.

- **Recording Sonora output and endpoint sidechain**: Every capture owns fresh persistent Sonora 0.2.0 state at 12 dB for outgoing 16 kHz PCM. Its input is the dry four-channel HPF/mix/FIR branch, quantized to PCM16 before suppression; it never receives RNNoise output. A separate unchanged RNNoise branch supplies endpoint PCM, RMS, VAD and 60 ms readiness cadence, preserving endpoint evidence including the existing VAD aggregation across large input chunks. Only Sonora PCM reaches Opus and the PCM trace. The two capture converters have no wind sender. Priming discards paired frames after advancing both states and consuming VAD; stopping or restarting drops both states. This duplicates classical conversion and retains RNNoise compute in addition to Sonora, so device cost and recognition changes remain unverified without hardware. Sonora adds 6 ms algorithmic delay to the dry output path; endpoint sample timing remains the previous RNNoise path, so equality of endpoint evidence does not establish equal transcript content or wall-clock scheduling. Local trace metadata names the output suppressor and endpoint sidechain.
