# W-track wire snapshots

Wire snapshots pin the JSON shape and canonical bytes produced by generated protocol types. Each `*.json` fixture is canonical single-line JSON, and each cargo-visible `*_wire_snapshot_test.rs` round-trips fixture entries through the relevant Rust types.

For generated shared families, entries contain request/response/event JSON. For iAP2 CSMs, entries contain:

```json
{"MessageName":{"json":{},"wire_hex":"40400006aa00"}}
```

The iAP2 test deserializes `json` into the generated CSM type, encodes it with `CsmCodec`, compares the raw bytes to `wire_hex`, decodes the bytes back into the CSM type, and serializes back to JSON. This catches both JSON-shape drift and iAP2 control-session wire drift.

## Adding or changing an entry

1. Add the fixture JSON shape to the family snapshot file.
2. Encode the fixture with the current Rust type/codec and write the resulting exact bytes as lowercase hex.
3. Add the type assertion to the matching Rust snapshot test.
4. Mirror shared fixtures to consumer repositories when that family crosses repo boundaries. iAP2 is mirrored only to iOS and Android because the UI never sees iAP2 CSM wire.
5. Run the focused cargo test first. If an encoder changes, the test failure shows expected-vs-actual hex; update the fixture only when the wire change is intentional.

## iAP2 CSM migration path

Tier 1.1 seeded iAP2 CSM inventory entries and emits daemon-internal generated CSM structs in `crates/iap2/src/csm/generated.rs`. Hand-written modules remain authoritative while migration proceeds. When a hand-written CSM is moved into inventory, add or keep its `iap2.json` entry so the generated type inherits the same wire contract. Hand-written CSMs without full decode support should not be added to the round-trip gate until they can complete encode -> decode -> JSON stability.
