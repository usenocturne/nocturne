# Top-level monorepo orchestration. Component-local recipes still live in
# each subdirectory's Justfile and are reachable via `just -f <path> ...` or
# `cd <path> && just ...`. The recipes below cover the common cross-component
# flows (build, test, codegen, deploy).

default:
    @just --list

# ---- Daemon (Rust) ------------------------------------------------------

# Cross-compile the daemon for aarch64 Car Thing hardware. Pulls in
# `--features device` so the real swupdate driver (vendored libswupdate
# IPC client) is compiled instead of the host-only stub.
daemon-build:
    cross build -p nocturned --target=aarch64-unknown-linux-gnu --release --features device

# Build the daemon for the dev host (no swupdate, dev features only).
daemon-host:
    cargo build -p nocturned

# Build + scp the daemon binary to the running Car Thing at 172.16.42.2.
daemon-copy: daemon-build
    scp target/aarch64-unknown-linux-gnu/release/nocturned root@172.16.42.2:/usr/bin/nocturned

# ---- Device UI (React + Vite + Bun) ------------------------------------

ui-dev:
    cd packages/ui && bun install && bun run dev

ui-build:
    cd packages/ui && bun install && bun run build

ui-lint:
    cd packages/ui && bun run lint-check

# ---- Connector (Pi OS + Bun web UI) ------------------------------------

connector-dev:
    cd packages/connector && bun install && bun run dev

connector-build:
    cd packages/connector && bun install && bun run build

# ---- Image (Yocto) -----------------------------------------------------

# Kick off the SWU image build. Long-running. Yocto's EXTERNALSRC points at
# `crates/daemon/` and `packages/ui/dist/`, so make sure those are built
# first if you want fresh contents.
image-build:
    cd image && ./scripts/build.sh

# ---- Codegen + workspace gates -----------------------------------------

# Regenerate wire-protocol bindings (TS/Swift/Kotlin) under
# crates/shared/generated/. Mirrors to NOCTURNE_APP_IOS_GENERATED /
# NOCTURNE_APP_ANDROID_GENERATED if those env vars are set.
codegen *args:
    cargo run --release -p nocturne-codegen --bin codegen -- {{ args }}

codegen-check:
    cargo run --release -p nocturne-codegen --bin codegen -- --check

codegen-mirror:
    cargo run --release -p nocturne-codegen --bin codegen -- --mirror

codegen-snapshot-review:
    cd tools/codegen && cargo insta review

# ---- Workspace lint / test --------------------------------------------

test:
    cargo test --workspace

test-emulator:
    cargo test --workspace --features iap2-rs/emulator

lint:
    cargo clippy --workspace -- -D warnings
    cargo fmt --check

fmt:
    cargo fmt
