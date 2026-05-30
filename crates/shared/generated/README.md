# Generated Sources

This directory is owned by `tools/codegen`. Contents are emitted from the canonical schema in `tools/codegen/src/dispatch/inventory.rs`.

**Hand-edits will be overwritten on the next `just codegen` run.** Modify the inventory or the emitters in `tools/codegen/src/dispatch/` instead.

Generated files ARE committed to ensure deterministic downstream consumer state across:
- Rust workspace (`crates/shared/generated/rust/`)
- TypeScript `.d.ts` for nocturne-ui JSDoc consumers (`generated/ts/`)
- Swift bindings for nocturne-app iOS (`generated/swift/`)
- Kotlin bindings for nocturne-app Android (`generated/kotlin/`)

Run `just codegen` to regenerate. Run `just codegen --mirror` to also write into the mobile app trees.
