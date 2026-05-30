# Non-OTA wire inventory checklist

Canonical names are snake_case. `source` metadata in `dispatch/inventory.rs` records current camelCase/PascalCase daemon or consumer spellings that need W-track migration review.

## Summary

| Family | Methods | Events | CSMs | Total |
|---|---:|---:|---:|---:|
| Bluetooth | 5 | 6 | 0 | 11 |
| Device | 19 | 5 | 0 | 24 |
| Audio | 2 | 1 | 0 | 3 |
| MediaControl | 8 | 4 | 0 | 12 |
| Spotify | 44 | 2 | 0 | 46 |
| Voice | 4 | 6 | 0 | 10 |
| BtOnly | 2 | 7 | 0 | 9 |
| Iap2 | 0 | 0 | 12 | 12 |
| **Total** | **84** | **31** | **12** | **127** |

## Bluetooth

### Methods
- [x] `bluetooth.devices.list`
- [x] `bluetooth.device.connect`
- [x] `bluetooth.device.disconnect`
- [x] `bluetooth.device.unpair` (`bluetooth.device.forget` legacy alias)
- [x] `bluetooth.discoverable`

### Events
- [x] `bluetooth.agent`
- [x] `bluetooth.pairing`
- [x] `bluetooth.connection`
- [x] `bluetooth.device`
- [x] `bluetooth.discoverable`
- [x] `bluetooth.mfi` (hot-file straggler beyond prior WS audit)

## Device

### Methods
- [x] `device.version`
- [x] `device.info`
- [x] `device.launch_app` (source: `device.launchApp`)
- [x] `device.timezone.get`
- [x] `device.time.get`
- [x] `device.power.reboot`
- [x] `device.power.shutdown`
- [x] `device.power.off` (audit canonical; current daemon maps only shutdown)
- [x] `device.factory_reset` (source: `device.factoryreset`)
- [x] `reset_boot_counter`
- [x] `device.brightness.get`
- [x] `device.brightness.set`
- [x] `device.brightness.auto`
- [x] `device.ab.get`
- [x] `device.ab.reset`
- [x] `device.ab.set_slot` (source: `device.ab.setSlot`)
- [x] `device.ab.set_boot_result` (source: `device.ab.setBootResult`)
- [x] `device.ab.failover`
- [x] `onboarding.set_state`

### Events
- [x] `app.ready`
- [x] `subscription.updated`
- [x] `network.status`
- [x] `notification.show`
- [x] `ambient_light_update` (hot-file straggler beyond prior WS audit)

## Audio

### Methods
- [x] `audio.record.start`
- [x] `audio.record.stop`

### Events
- [x] `audio.level`

## MediaControl

### Methods
- [x] `media.control.play`
- [x] `media.control.pause`
- [x] `media.control.next`
- [x] `media.control.previous` (`media.control.prev` legacy alias)
- [x] `media.control.shuffle`
- [x] `media.control.repeat`
- [x] `media.control.volume_up` (source: `media.control.volumeUp`)
- [x] `media.control.volume_down` (source: `media.control.volumeDown`)

### Events
- [x] `media.now_playing.update` (source: `media.nowPlaying.update`)
- [x] `media.now_playing.artwork` (source: `media.nowPlaying.artwork`)
- [x] `media.now_playing.artwork.failed` (source: `media.nowPlaying.artwork.failed`)
- [x] `phone.volume.update`

## Spotify

### Methods
- [x] `spotify.player.state`
- [x] `spotify.player.play`
- [x] `spotify.player.pause`
- [x] `spotify.player.next`
- [x] `spotify.player.previous`
- [x] `spotify.player.seek`
- [x] `spotify.player.volume`
- [x] `spotify.player.shuffle`
- [x] `spotify.player.repeat`
- [x] `spotify.player.transfer`
- [x] `spotify.player.speed`
- [x] `spotify.player.queue`
- [x] `spotify.player.queue.add`
- [x] `spotify.artist.get`
- [x] `spotify.artist.top_tracks` (source: `spotify.artist.topTracks`)
- [x] `spotify.album.get`
- [x] `spotify.album.tracks`
- [x] `spotify.playlist.get`
- [x] `spotify.playlist.tracks`
- [x] `spotify.show.get`
- [x] `spotify.show.episodes`
- [x] `spotify.me.profile`
- [x] `spotify.me.tracks`
- [x] `spotify.me.tracks.contains`
- [x] `spotify.me.tracks.save`
- [x] `spotify.me.tracks.remove`
- [x] `spotify.me.playlists`
- [x] `spotify.me.shows`
- [x] `spotify.me.shows.save`
- [x] `spotify.me.shows.remove`
- [x] `spotify.me.shows.contains`
- [x] `spotify.me.top_artists` (source: `spotify.me.topArtists`)
- [x] `spotify.me.top_tracks` (source: `spotify.me.topTracks`)
- [x] `spotify.me.recently_played` (source: `spotify.me.recentlyPlayed`)
- [x] `spotify.devices`
- [x] `spotify.radio.mixes`
- [x] `spotify.radio.playlist`
- [x] `spotify.radio.top_mix` (source: `spotify.radio.topMix`)
- [x] `spotify.radio.discoveries`
- [x] `spotify.track.lyrics`
- [x] `spotify.dj.start`
- [x] `spotify.dj.signal`
- [x] `spotify.auth.get_status` (source: `spotify.auth.getStatus`)
- [x] `spotify.image.fetch`

### Events
- [x] `spotify.auth.status`
- [x] `spotify.auth.completed`

## Voice

### Methods
- [x] `wakeword.pause`
- [x] `wakeword.resume`
- [x] `tts.speak`
- [x] `tts.stop`

### Events
- [x] `voice.wakeword`
- [x] `voice.wakeword.state`
- [x] `voice.transcription`
- [x] `ai.state`
- [x] `ai.response`
- [x] `ai.tool_executed`

## BtOnly

### Methods
- [x] `ping`
- [x] `device.volume.update`

### Events
- [x] `daemon.ready`
- [x] `daemon.heartbeat`
- [x] `chunk.retransmit_request`
- [x] `audio.recording.started`
- [x] `audio.data`
- [x] `audio.recording.stopped`
- [x] `keepalive`

## Iap2

Daemon-internal iAP2 Control Session Messages (CSMs) now have seed inventory entries in `tools/codegen/src/dispatch/inventory.rs`. `just codegen` writes derived structs to `crates/iap2/src/csm/generated.rs`; the hand-written `crates/iap2/src/csm/*.rs` modules remain authoritative until a CSM is explicitly migrated to the generated module.

### Seeded CSMs

- [x] `RequestAuthenticationCertificate` (`0xAA00`, received by accessory)
- [x] `AuthenticationCertificate` (`0xAA01`, sent by accessory)
- [x] `RequestAuthenticationChallengeResponse` (`0xAA02`, received by accessory)
- [x] `AuthenticationResponse` (`0xAA03`, sent by accessory)
- [x] `AuthenticationFailed` (`0xAA04`, received by accessory)
- [x] `AuthenticationSucceeded` (`0xAA05`, received by accessory)
- [x] `StartIdentification` (`0x1D00`, received by accessory)
- [x] `IdentificationAccepted` (`0x1D02`, received by accessory)
- [x] `DeviceInformationUpdate` (`0x4E09`, received by accessory)
- [x] `DeviceLanguageUpdate` (`0x4E0A`, received by accessory)
- [x] `DeviceTimeUpdate` (`0x4E0B`, received by accessory)
- [x] `DeviceUUIDUpdate` (`0x4E0C`, received by accessory)

### Migration path

1. Add or update a `Csm` entry in `CSM_INVENTORY` with the message id, direction, and param list.
2. Run `just codegen` (or `cargo run -p nocturne-codegen --bin codegen`) and inspect `crates/iap2/src/csm/generated.rs`.
3. Move call sites to `crate::csm::generated::<Type>` only after the generated params match the hand-written type byte-for-byte.
4. Leave framework CSM message-list behavior (`IdentificationInformation` params 6/7) under the hand-written modules until Tier 1.3 collapses generated and manual CSM declarations.

## Drift hot spots captured in inventory metadata

- Method casing: `device.launchApp`, `device.factoryreset`, `device.ab.setSlot`, `device.ab.setBootResult`, `media.control.volumeUp`, `media.control.volumeDown`, Spotify `topTracks`/`topArtists`/`recentlyPlayed`/`topMix`/`getStatus`.
- Field casing: `bundleId`, `shortVersion`, `gitHash`, `buildDate`, `fullVersion`, `serialNumber`, `subscriptionStatus`, `hasLifetime`, `spotifySkipped`, `contentType`, `volumePercent`, audio `sampleRate`/`frameMs`/`totalFrames`.
- Apple now-playing payload currently uses PascalCase iAP2 keys (`MediaItemAttributes`, `PlaybackAttributes`); inventory wraps them as canonical snake_case objects for generated types.
- Spotify content lookups use mixed `id` and `content_id`; inventory selects canonical `content_id` and records current source names.
- `device.power.off` appeared in the audit, but current daemon hot path only implements `device.power.shutdown`; inventory calls this out for W-device follow-up.
