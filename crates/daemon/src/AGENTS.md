# NOCTURNED DAEMON — MODULE MAP

## OVERVIEW

Binary crate (`main.rs` entry). Domain modules under `src/` orchestrate Bluetooth, iAP2, WebSocket/HTTP, audio, wake word, hardware, system config, and OTA subsystems.

## STRUCTURE

```
src/
├── main.rs                 # Entry point: tracing, config, image cache, WS/HTTP servers, audio, wakeword, BT daemon
├── error.rs                # NocturnedError enum (thiserror)
├── bluetooth/
│   ├── mod.rs              # RFCOMM listener, SDP registration, connection dispatch
│   ├── accessory_setup.rs  # iOS 18+ AccessorySetupKit and Android pairing BLE bootstrap: connectable advertisement (service data `NOCT` under c0afc129-0068-48df-a60e-d1fedffed3cd) + iOS encrypt-read identity characteristic (fffb2ace-8c85-4ca2-9096-77831dfc84a6). Explicit classic discoverability keeps the advertisement active even with an existing LE link so Android can pair while an iPhone is connected. Outside that pairing window, an LE ACL withdraws the advertisement and disconnect recreates it for bonded-peer reconnect, avoiding the legacy controller's stale advertising state. UUIDs are pinned by the iOS app's Info.plist/AccessorySetupService.swift and the Android app's BLE filter.
│   ├── ancs.rs             # iOS notification client over the bonded BLE ANCS service. Requires a live LE ACL, enumerates cached BlueZ GATT objects without trusting the transport-blind Connected flag, rebuilds stale GATT subscriptions when BlueZ removes the LE device, fetches attributes serially, and emits notification.show/remove to the UI.
│   ├── hci.rs              # Raw controller connection-list queries used to distinguish LE ACLs from simultaneous classic iAP2 ACLs and coordinate legacy advertising lifetime.
│   └── pairing.rs          # D-Bus Bluetooth agent for pairing
├── iap2/
│   └── mod.rs              # Bridge to iap2-rs crate: config, events, EA session routing, MFi worker (iap2_rs::WorkerMfiAccess over /dev/i2c-3)
├── hardware/
│   ├── mod.rs              # Hardware re-exports
│   ├── brightness.rs       # Display brightness + ambient light sensor
│   └── image_cache.rs      # Disk-backed image cache for album art
├── audio/
│   ├── mod.rs              # Audio/wake word re-exports
│   ├── capture.rs          # arecord capture, Opus encoding, broadcast channel
│   └── wakeword.rs         # ONNX-based wake word detector
├── system/
│   ├── mod.rs              # System re-exports
│   ├── config.rs           # Config loading from /etc/nocturne/config.json and device metadata from /etc/superbird
│   └── ab.rs               # A/B partition management via /dev/misc
├── http/
│   ├── mod.rs              # HTTP/WebSocket re-exports
│   ├── websocket.rs        # WebSocket server on port 5000, UI broadcast
│   └── webapp.rs           # Webapp HTTP server on localhost:8080
├── app/
│   ├── mod.rs              # AppCommunicationManager, AppMessage, session multiplexing (179 lines)
│   ├── msgpack.rs          # MsgPack RPC handler: chunking, CRC32, EA commands (1,604 lines)
│   └── websocket_handler.rs # WebSocket→iPhone command routing (297 lines)
└── ota/                    # OTA actors, slots, SWUpdate bindings, delta source, swap helpers
```

## DATA FLOW

```
main.rs
  ├─ system::Config::load()
  ├─ hardware::init_brightness()
  ├─ hardware::ImageCache::new()
  ├─ http::WebSocketServer::new(port=5000)
  ├─ audio::AudioCapture::new() → broadcast channel
  ├─ audio::WakeWordDetector::new() → event channel
  └─ bluetooth::BluetoothDaemon::new() → .run()
       └─ per-connection: iap2::Iap2Connection::run()
            ├─ iap2-rs connect(stream, config)
            ├─ ConnectionEvent loop: Link → Auth → Identification → EA sessions
            ├─ AppCommunicationManager (app/mod.rs)
            │   ├─ MsgPackProtocolHandler (app/msgpack.rs) ← EA data
            │   └─ WebSocketProtocolHandler (app/websocket_handler.rs) ← WS data
            └─ NowPlaying state → WebSocket broadcast
```

## WHERE TO LOOK

| Task | File | Key Types/Functions |
|------|------|---------------------|
| Add Spotify command | `app/websocket_handler.rs` | `handle_message()` match arms |
| Add EA protocol handler | `app/mod.rs` | `AppProtocolHandlerEnum`, `register_handler()` |
| Modify chunking/CRC | `app/msgpack.rs` | `create_chunks()`, `parse_one_chunk_envelope()`, `process_inbound()` (per-session reassembly buffer), CHUNK_SIZE=2000 |
| iAP2 config (EA protocols, NowPlaying) | `iap2/mod.rs` | `Iap2Config` construction |
| MFi auth | `iap2/mod.rs` | `iap2_rs::MfiAuth::open_default()` + `iap2_rs::WorkerMfiAccess` (userspace i2c on `/dev/i2c-3` @ `0x10`) |
| Bluetooth SDP/advertising | `bluetooth/mod.rs` | `register_sdp_record()`, `set_advertising()`; startup recreates the BlueZ session and retries adapter initialization indefinitely with capped backoff while HTTP and WebSocket stay available. D-Bus ownership races, `NotFound`, `NotReady`, and BlueZ `Busy` must not exit the daemon. |
| Explicit pairing window | `bluetooth/mod.rs`, `http/websocket.rs` | Startup keeps `Discoverable` and `Pairable` off. `bluetooth.discoverable` serializes both properties for the first-run QR screen and later explicit pairing surfaces, rolls back partial opens, and attempts both closes. SPP accepts an inbound peer only when it is paired or is the exact target of a short-lived Android wake grant. |
| iAP2 half-open recovery | `bluetooth/mod.rs` | BlueZ can name a bonded iPhone object with its pre-pairing private address while `Device1.Address` exposes the stable identity. Always resolve either address to the live object, but key iAP2 sessions, recent pairing timestamps, UI events, and reconnect tasks by the stable identity. The initial paired snapshot and later `Paired` property changes share one handler, closing the monitor-startup race. Incomplete candidate metadata gets bounded retries without dialing an unclassified peer. A running reconnect promotes its pairing timestamp, task key, and RFCOMM target when BlueZ exposes the stable identity. `arm_iap2_reconnect` and `iap2_reconnect_loop` deduplicate private, object, and canonical addresses, stop when BlueZ marks the device blocked, dial fixed RFCOMM channel 1 with 2s to 30s backoff, then use `ConnectProfile(IAP2_DEVICE_UUID)` as a fallback. Known iAP2 peers reconnect after connection loss without rechecking classification. Android and macOS peers must not enter this direct iAP2 path. |
| Audio pipeline | `audio/capture.rs`, `audio/mod.rs`, `audio/wind.rs` | `AudioCapture`, `AudioCommand::Start/Stop`; PCM conversion stays on the capture path while raw four-channel wind analysis runs in a bounded batch worker to protect wake-word real-time headroom. |
| Wake word | `audio/wakeword.rs`, `main.rs`, `http/websocket.rs` | `WakeWordDetector`, ONNX model loading from `/etc/nocturne/models`, per-keyword peak/support score gates, and the global candidate accept/reject handshake. Synchronous model parsing and optimization belong in `spawn_blocking`, outside Tokio worker threads. Playback state parsing accepts `PlaybackStatus`, `playback_status`, and `playbackStatus`. |
| WebSocket events to UI | `http/websocket.rs` | `broadcast_event()`, `WebSocketServer` |
| Display sleep | `hardware/brightness.rs`, `http/websocket.rs` | `sleep_display()`, `wake_display()`, `device.display.*`; transient backlight sleep, separate from UI lock, never persisted brightness |
| OTA updates | `ota/` + `app/msgpack.rs` | `OtaActor` owns stream/verify/write/confirm. UI triggers `ota.request_check` and `ota.request_install`; the daemon forwards both to the companion, receives `ota.package_ready`, then pulls negotiated `device.ota.transfer` windows through `Command::PulledChunk`. Updated companions advertise checksum-envelope support, `msgpack_binary` transfer data, and a maximum window capped at 256 KiB; missing capability falls back to 1800 bytes. MessagePack inbound, per-message reassembly, and aggregate pending-payload caps are 512 KiB so one complete 256 KiB binary or base64-compatible response plus protocol overhead fits without unbounded buffering. Package-ready metadata must match the active begin; installer kind, target version, durable device resume offset, and the last negotiated window are persisted through reconnects. A repeated package-ready offset is advisory because the actor returns the authoritative on-disk offset before the pull task starts. Each compatible package-ready replaces the persisted window with the current companion's capped advertisement, so an upgraded companion can grow beyond a smaller recovery value while continuing from the exact durable byte offset. Before pulling or recovering, the daemon requires the target to be strictly newer than the installed lane for its kind, comparing image targets with the rootfs image version and all other targets with the bandaid version. SemVer core and prerelease sort first, followed by the numeric `+build` timestamp. OTA responses use native MessagePack binary inside checksum envelopes on the bulk lane, while player/control traffic and exact-route retransmit requests use normal priority. The daemon selectively normalizes only binary `Result.result.data`, avoiding global binary conversion changes for asset-range events. It keeps one request in flight, waits for the actor write acknowledgment before advancing, yields between windows, and pauses briefly every 16 windows. Full image OTA keeps the delta source active until SWUpdate reports terminal success or failure through the control-status path; progress socket closure alone is not completion. During zchunk fetches SWUpdate connects to nocturned's Unix socket delta source, which forwards exact `ota.asset_range` requests to the pinned peer and connection route and emits asset-scoped `OtaProgress` (`asset`, `transferredBytes`, `totalBytes`) so the UI can distinguish boot and system image delta transfers. Image OTA derives the write target from the actual running `superbird.slot` kernel argument rather than the next-boot U-Boot selection, so a second staged update cannot overwrite the mounted rootfs after SWUpdate flips `slot_active`. Partial payloads and manifests survive daemon or companion reconnects, and a same-peer `ota.begin` rebinds the active connection route before resuming. Stale routes cannot send chunks or delta replies. A write cannot be cancelled after it starts; write completion and failure messages are scoped by update ID plus a unique write ID so an old task cannot finalize a newer update. Delta range streams fail after 60 seconds without a chunk instead of hanging indefinitely. A standalone webapp package is validated before the active UI is rotated. Successful non-image promotions atomically write the canonical bandaid `.floor-version`; device version metadata exposes rootfs image and bandaid versions separately while preserving the effective legacy version. Asset-range/image-delta and legacy push messages still route through the matching OTA commands. |
| `media.control.*` routing | `app/hid_mapping.rs` (shared mapping), `iap2/mod.rs` (WebSocket source), `app/msgpack.rs` (phone EA source) | Both sources resolve via `method_to_hid_command`. WebSocket path calls `lib_conn.send_hid_command` directly; Phone EA path forwards through `hid_tx` channel — see MEDIA CONTROL / HID below |
| Companion media artwork correlation | `app/msgpack.rs`, `iap2/mod.rs` | Preserve optional companion `media_generation` across camel-case or snake-case normalization for now-playing metadata and artwork. Native iAP2 leaves it absent. The UI requires equal generations or two absent generations before applying artwork. |
| `notification.show` / `notification.remove` (UI alerts) | `bluetooth/ancs.rs`, `app/msgpack.rs` | Native iOS ANCS emits session-scoped `ancs:<uid>` notifications with app bundle/name metadata and removal events. Companion-emitted `notification.show` events still use the same UI path. Consumed by `packages/ui/src/components/common/notifications/NotificationBridge.tsx`. |
| Native phone calls | `iap2/telephony.rs`, `iap2/mod.rs`, `app/msgpack.rs`, `http/websocket.rs` | Merge sparse iAP2 updates into full `phone.call.*` snapshots and accept equivalent Android lifecycle events over SPP. Companion event `device` is replaced with the observed peer. `phone.call.accept`, `phone.call.decline`, and `phone.calls.get` target the exact active Android route only when `app.ready` platform and peer match; otherwise they use `iap2:<device>` without an app-ready gate. |
| Verified phone entitlements | `app/msgpack.rs`, `http/websocket.rs` | Normalize `app.ready` and `subscription.updated` from companion camel case to canonical snake case, including optional `is_admin` and `entitlements_verified`, then keep the active route's cached replay synchronized with later subscription updates. |
| Phone reconnect / session repair | `bluetooth/mod.rs` (`connect_to_device`), `iap2/mod.rs` (RequestAppLaunch in `run_iap2_connection`) | Routine reconnect policy lives in the UI (`packages/ui/src/hooks/useNocturned.js` watchdog), which dials `bluetooth.device.connect` when BlueZ reports connected but no `bluetooth.connection` session is live. The daemon also starts iAP2 recovery automatically for a newly paired iOS candidate and after a known iAP2 link closes. Daemon side: (1) `connect_to_device` is idempotent and returns `connected` immediately if an iAP2/SPP session already exists, so UI dials are always safe; (2) on a **cold start only**, when an iAP2 link is up but no EA session has *ever* arrived on this link within 2.5s (iOS app not running), the daemon sends `RequestAppLaunch` for `com.usenocturne.nocturne` (retry every 15s, max 5). When the phone **paired within the last 2 minutes** (`recent_pairings` in `bluetooth/mod.rs`, fed by the device monitor's Paired events), the first attempt fires at 250ms instead. This is the Settings > Bluetooth setup flow, where the user expects the app to open. The window is tight because iOS ignores `RequestAppLaunch` for an already-running app and background-launches the app itself on accessory attach. A visible foreground launch only happens when this request beats the app's background EA connect in fresh install, reboot, or force-quit setup cases; a warm app reconnects in about 2s and wins, which is correct because it should stay in the background then. Gated by the per-`run_iap2_connection` `ea_session_ever_established` latch: once the app opens an EA session even once, the daemon will never force-foreground it again on that link, even if the user backgrounds the app and the EA session drops. This is intentional: foregrounding is "open once per drive, then leave the user alone". The latch resets only when the iAP2 link fully cycles through a fresh `run_iap2_connection`. It does not touch `app_ready_received`, the `daemon.ready` resend gate. The live foreground path is the UI's `device.launchApp` on `app.ready`; see `packages/ui/src/hooks/useNocturned.js` (`appLaunchRequested` once-per-drive gate). This daemon latch is defense-in-depth. |
| macOS connector reconnect | `bluetooth/mod.rs` (`connect_to_device`, `probe_macos_connector`) | Computer-class paired devices are treated as macOS connector targets before the iOS iAP2 ConnectProfile attempt: the daemon opens a short RFCOMM probe to the Mac's Bluetooth-Incoming-Port listener on channel `3`, then waits for the Mac app to dial back to the Car Thing SPP/RPC server on channel `2`. Do not move this into a Mac-side polling loop; the Mac connector must only dial channel `2` in response to the inbound probe. Android wake remains the fallback for non-computer targets. |

## CONVENTIONS

- All IO through tokio async — never block the runtime
- `tracing::{info, debug, warn, error}` for structured logging everywhere
- Error propagation: `Result<T>` with `NocturnedError` via `thiserror`
- Channel patterns: `mpsc::unbounded_channel` for command/event routing, `broadcast` for audio
- Module-level constants for hardware paths (not configurable — device-specific)

## MEDIA CONTROL / HID

`media.control.*` RPCs arrive from TWO sources with TWO different emission paths. Both share the canonical method-string-to-`HidCommand` mapping helper in `src/app/hid_mapping.rs` (`method_to_hid_command(&str) -> Option<iap2_rs::HidCommand>`):

- **UI WebSocket** (Car Thing browser → daemon): handled inline in `iap2::handle_websocket_message_new` at `src/iap2/mod.rs:~755-782`. Resolves via `crate::app::hid_mapping::method_to_hid_command`, then emits DIRECTLY via `lib_conn.send_hid_command(cmd)` — bypassing the channel. This is pre-existing behavior preserved unchanged.

- **Phone EA** (iOS nocturne-app → daemon via MessagePack RPC): handled in `MsgPackProtocolHandler::handle_msgpack_message` at `src/app/msgpack.rs:~525`. The handler is configured with a clone of `hid_tx: UnboundedSender<HidCommand>` via `MsgPackProtocolHandler::set_hid_tx(...)` (declared at `src/app/msgpack.rs:~194`, wired at `src/iap2/mod.rs:~285`). When `method.starts_with("media.control.")`, the handler resolves via `method_to_hid_command` and forwards through `hid_tx.send(cmd)`; the receiver `hid_rx` (drained in `run_iap2_connection`'s select loop) calls `lib_conn.send_hid_command(cmd)`.

**Architectural dichotomy (intentional)**: Both paths share the same mapping helper but emit through DIFFERENT channels. Migrating the WebSocket path to `hid_tx` is explicitly out of scope for the `ai-tools-phone-hid-routing` plan.

Supported methods (11 total, both sources): `play`, `pause`, `playPause`/`togglePlayPause`, `next`, `previous`/`prev`, `shuffle`, `repeat`, `volumeUp`, `volumeDown`.

## ANTI-PATTERNS

- **Don't add `lib.rs`**: This is intentionally a binary crate; shared types live in module files
- **Don't refactor hardcoded paths**: `/etc/nocturne/`, `/etc/superbird`, `/dev/i2c-3` (MFi @ `0x10`), `/dev/misc`, efuse nvmem cells, ALSA `hw:0,0`, and Amlogic TODDR_A/B `IN 4` are Car Thing filesystem/audio constants
- **Don't block tokio**: Audio/wakeword use `tokio::spawn` with internal buffering
- **Chunk envelope format is fixed**: iOS app expects exact 36-char UUID message IDs, CRC32 checksums, 2000-byte chunks — changing breaks the wire protocol
- **`media.control.*` routing shares ONE canonical mapping helper**: `src/app/hid_mapping.rs` is the single source of truth for method-string→HidCommand. Don't duplicate or hardcode `media.control.*` strings in callers. The WebSocket path (existing, inline at `src/iap2/mod.rs:~755-782`) emits HID directly via `lib_conn.send_hid_command`; the Phone EA path (added at `src/app/msgpack.rs:~525`) emits via the `hid_tx` channel through `MsgPackProtocolHandler`. These are intentional separate paths. Don't migrate the WebSocket path to `hid_tx` without a follow-up plan.
