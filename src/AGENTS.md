# NOCTURNED DAEMON — MODULE MAP

## OVERVIEW

Binary crate (`main.rs` entry). 17 modules, ~8.6K lines. Async tokio runtime orchestrating Bluetooth, iAP2, WebSocket, audio, and wake word subsystems.

## STRUCTURE

```
src/
├── main.rs                 # Entry point: tracing, config, image cache, WS server, audio, wakeword, BT daemon (184 lines)
├── bluetooth.rs            # RFCOMM listener, SDP registration, connection dispatch (1,738 lines)
├── bluetooth_agent.rs      # D-Bus Bluetooth agent for pairing (311 lines)
├── iap2_wrapper.rs         # Bridge to iap2-rs crate: config, events, EA session routing (873 lines)
├── websocket.rs            # WebSocket server on port 5000, UI broadcast (1,399 lines)
├── app/
│   ├── mod.rs              # AppCommunicationManager, AppMessage, session multiplexing (179 lines)
│   ├── msgpack.rs          # MsgPack RPC handler: chunking, CRC32, EA commands (1,604 lines)
│   └── websocket_handler.rs # WebSocket→iPhone command routing (297 lines)
├── audio.rs                # arecord capture, Opus encoding, broadcast channel (472 lines)
├── wakeword.rs             # ONNX-based wake word detector (457 lines)
├── mfi.rs                  # MFi chip interface: /dev/apple_mfi IOCTLs (266 lines)
├── mfi_impl.rs             # HardwareMfiProvider for iap2-rs auth trait (34 lines)
├── config.rs               # Config loading from /etc/nocturne/config.json (141 lines)
├── error.rs                # NocturnedError enum (thiserror) (46 lines)
├── ab.rs                   # A/B partition management via /dev/misc (198 lines)
├── brightness.rs           # Display brightness + ambient light sensor (299 lines)
└── image_cache.rs          # Disk-backed image cache for album art (95 lines)
```

## DATA FLOW

```
main.rs
  ├─ config::Config::load()
  ├─ brightness::init_brightness()
  ├─ image_cache::ImageCache::new()
  ├─ websocket::WebSocketServer::new(port=5000)
  ├─ audio::AudioCapture::new() → broadcast channel
  ├─ wakeword::WakeWordDetector::new() → event channel
  └─ bluetooth::BluetoothDaemon::new() → .run()
       └─ per-connection: iap2_wrapper::Iap2Connection::run()
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
| iAP2 config (EA protocols, NowPlaying) | `iap2_wrapper.rs` | `Iap2Config` construction |
| MFi auth | `mfi.rs` + `mfi_impl.rs` | `MfiChip`, `HardwareMfiProvider` |
| Bluetooth SDP/advertising | `bluetooth.rs` | `register_sdp_record()`, `set_advertising()` |
| Audio pipeline | `audio.rs` | `AudioCapture`, `AudioCommand::Start/Stop` |
| Wake word | `wakeword.rs` | `WakeWordDetector`, ONNX model loading from `/etc/nocturne/models` |
| WebSocket events to UI | `websocket.rs` | `broadcast_event()`, `WebSocketServer` |
| OTA updates | `app/msgpack.rs` | `download_ota_chunks_task()`, MD5 verification |
| `media.control.*` routing | `app/hid_mapping.rs` (shared mapping), `iap2_wrapper.rs` (WebSocket source), `app/msgpack.rs` (phone EA source) | Both sources resolve via `method_to_hid_command`. WebSocket path calls `lib_conn.send_hid_command` directly; Phone EA path forwards through `hid_tx` channel — see MEDIA CONTROL / HID below |
| `notification.show` (UI alerts) | `app/msgpack.rs` (explicit log branch) | Phone-emitted events with `{id, title, body, category, daysUntilExpiry, timestamp}`. Forwarded to WebSocket UI clients via the existing `broadcast_event` fallthrough; the explicit branch only adds logging. Consumed by `nocturne-ui/src/components/common/notifications/NotificationBridge.jsx`. |

## CONVENTIONS

- All IO through tokio async — never block the runtime
- `tracing::{info, debug, warn, error}` for structured logging everywhere
- Error propagation: `Result<T>` with `NocturnedError` via `thiserror`
- Channel patterns: `mpsc::unbounded_channel` for command/event routing, `broadcast` for audio
- Module-level constants for hardware paths (not configurable — device-specific)

## MEDIA CONTROL / HID

`media.control.*` RPCs arrive from TWO sources with TWO different emission paths. Both share the canonical method-string-to-`HidCommand` mapping helper in `src/app/hid_mapping.rs` (`method_to_hid_command(&str) -> Option<iap2_rs::HidCommand>`):

- **UI WebSocket** (Car Thing browser → daemon): handled inline in `iap2_wrapper::handle_websocket_message_new` at `src/iap2_wrapper.rs:~755-782`. Resolves via `crate::app::hid_mapping::method_to_hid_command`, then emits DIRECTLY via `lib_conn.send_hid_command(cmd)` — bypassing the channel. This is pre-existing behavior preserved unchanged.

- **Phone EA** (iOS nocturne-app → daemon via MessagePack RPC): handled in `MsgPackProtocolHandler::handle_msgpack_message` at `src/app/msgpack.rs:~525`. The handler is configured with a clone of `hid_tx: UnboundedSender<HidCommand>` via `MsgPackProtocolHandler::set_hid_tx(...)` (declared at `src/app/msgpack.rs:~194`, wired at `src/iap2_wrapper.rs:~285`). When `method.starts_with("media.control.")`, the handler resolves via `method_to_hid_command` and forwards through `hid_tx.send(cmd)`; the receiver `hid_rx` (drained in `run_iap2_connection`'s select loop) calls `lib_conn.send_hid_command(cmd)`.

**Architectural dichotomy (intentional)**: Both paths share the same mapping helper but emit through DIFFERENT channels. Migrating the WebSocket path to `hid_tx` is explicitly out of scope for the `ai-tools-phone-hid-routing` plan.

Supported methods (11 total, both sources): `play`, `pause`, `playPause`/`togglePlayPause`, `next`, `previous`/`prev`, `shuffle`, `repeat`, `volumeUp`, `volumeDown`.

## ANTI-PATTERNS

- **Don't add `lib.rs`**: This is intentionally a binary crate; shared types live in module files
- **Don't refactor hardcoded paths**: `/etc/nocturne/`, `/dev/apple_mfi`, `/dev/misc` are Car Thing filesystem constants
- **Don't block tokio**: Audio/wakeword use `tokio::spawn` with internal buffering
- **Chunk envelope format is fixed**: iOS app expects exact 36-char UUID message IDs, CRC32 checksums, 2000-byte chunks — changing breaks the wire protocol
- **`media.control.*` routing shares ONE canonical mapping helper**: `src/app/hid_mapping.rs` is the single source of truth for method-string→HidCommand. Don't duplicate or hardcode `media.control.*` strings in callers. The WebSocket path (existing, inline at `src/iap2_wrapper.rs:~755-782`) emits HID directly via `lib_conn.send_hid_command`; the Phone EA path (added at `src/app/msgpack.rs:~525`) emits via the `hid_tx` channel through `MsgPackProtocolHandler`. These are intentional separate paths. Don't migrate the WebSocket path to `hid_tx` without a follow-up plan.
