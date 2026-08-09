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

# Build only nocturned through Yocto, copy it into the bandaid overlay, and
# restart the on-device services.
daemon-deploy host="nocturne.local" binary="image/build/tmp/work/cortexa53-poky-linux/nocturned/2.1.0/image/usr/lib/nocturne/daemon/nocturned.current" target="nocturne-local":
    cd image && just build-nocturned {{target}}
    just daemon-install {{host}} {{binary}}

# Copy an existing daemon binary into the bandaid overlay and restart services.
daemon-install host="nocturne.local" binary="image/build/tmp/work/cortexa53-poky-linux/nocturned/2.1.0/image/usr/lib/nocturne/daemon/nocturned.current":
    @if [ ! -f "{{binary}}" ]; then echo "Missing {{binary}}"; echo "Run: just daemon-deploy {{host}}"; exit 1; fi
    scp "{{binary}}" root@{{host}}:/var/lib/bandaid/nocturne/daemon/nocturned.next
    ssh root@{{host}} 'set -eu; systemctl stop nocturned || true; if [ -f /var/lib/bandaid/nocturne/daemon/nocturned.current ]; then cp /var/lib/bandaid/nocturne/daemon/nocturned.current /var/lib/bandaid/nocturne/daemon/nocturned.previous; fi; mv /var/lib/bandaid/nocturne/daemon/nocturned.next /var/lib/bandaid/nocturne/daemon/nocturned.current; chmod 0755 /var/lib/bandaid/nocturne/daemon/nocturned.current; sync; systemctl restart superbird-weston; systemctl restart nocturned; sha256sum /opt/nocturne/daemon/nocturned.current; for i in $(seq 1 20); do pid=$(pidof nocturned.current || true); [ -n "$pid" ] && break; sleep 0.5; done; if [ -n "$pid" ]; then sha256sum /proc/$pid/exe; else echo "warning: nocturned not running yet"; fi'

# Build with cross instead of Yocto, then deploy that binary.
daemon-deploy-cross host="nocturne.local": daemon-build
    just daemon-install {{host}} target/aarch64-unknown-linux-gnu/release/nocturned

# Back-compat alias for daemon-deploy.
daemon-copy host="nocturne.local":
    just daemon-deploy {{host}}

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
    cd image && just build

# Build and publish a signed full + zchunk image OTA using one exact version.
# Usage: just release-image 4.1.0 /secure/nocturne.pem [delta-from-versions] [variant] [target]
release-image version_core signing_key delta_from_versions="*" variant="prod" target="nocturne-local":
    image/scripts/nocturne-release-image {{quote(version_core)}} {{quote(signing_key)}} {{quote(delta_from_versions)}} {{quote(variant)}} {{quote(target)}}

# Build and export a combined daemon + UI bandaid OTA plus a replaceable bandaid.ext4.
# Usage: just release-bandaid 4.2.1 4.2.0+20260725192800 [channel]
# Set NOCTURNE_BUILD_ID to reproduce a known release version.
release-bandaid version_core minimum_image_version channel="stable":
    image/scripts/nocturne-release-bandaid {{quote(version_core)}} {{quote(minimum_image_version)}} {{quote(channel)}}

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
    @if [ "$(uname -s)" = "Linux" ]; then \
        cargo clippy --workspace -- -D warnings; \
    else \
        cross clippy --workspace --target=aarch64-unknown-linux-gnu --release --features device -- -D warnings; \
    fi
    cargo fmt --check

fmt:
    cargo fmt
