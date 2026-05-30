# Codegen golden snapshots

The `nocturne-codegen` crate uses `insta` snapshots for byte-stable golden tests of the generated device-family emitter output.

Snapshots live in `tools/codegen/tests/golden/snapshots/` and cover Rust, TypeScript, Swift, and Kotlin. CI should run `cargo test -p nocturne-codegen --test golden` so accidental emitter changes fail with an explicit diff.

After an intentional emitter change, review and bless the new snapshots with either:

```bash
cargo insta review
```

from `tools/codegen/`, or:

```bash
INSTA_UPDATE=auto cargo test -p nocturne-codegen --test golden
```

from the workspace root.
