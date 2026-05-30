<h1 align="center">
  <img src="https://usenocturne.com/images/logo.png" alt="Nocturne" width="200">
  <br>
  Nocturne
  <br>
</h1>

<p align="center">The most advanced custom firmware for the <a href="https://carthing.spotify.com" target="_blank">Spotify Car Thing</a>.</p>

<p align="center">
  <a href="#flashing">Flashing</a> •
  <a href="#donate">Donate</a> •
  <a href="#building">Building</a> •
  <a href="#layout">Layout</a> •
  <a href="#credits">Credits</a> •
  <a href="#license">License</a>
</p>

<div align="center">
  <a href="https://usenocturne.com"><img alt="Website" src="https://img.shields.io/badge/website-gray?style=flat-square&logo=react&logoColor=FFFFFF"></a>
  <a href="https://discord.gg/mnURjt3M6m"><img alt="Discord" src="https://img.shields.io/discord/1304909652387172493?style=flat-square&logo=discord&logoColor=FFFFFF&label=discord"></a>
</div>

<br>

<p align="center"><img width=600 src="https://usenocturne.com/images/nocturne.png" alt="Nocturne screenshot"></p>

## Setup

> [!WARNING]
> Bricking the Car Thing is nearly impossible, but the risk is always there when flashing custom firmware.

### Requirements

- A booted Linux/macOS host (Windows under WSL works for flashing but not for builds)
- [`flashthing-cli`](https://crates.io/crates/flashthing-cli) installed via `cargo install flashthing-cli`
- Your user in the `dialout` (Debian/Ubuntu) or `uucp` (Arch) group for `/dev/ttyUSB*`

### Flashing

1. Download a flashthing zip from [Releases](https://github.com/usenocturne/nocturne/releases) (the file ends in `-superbird-flashthing.zip`)
2. Put the Car Thing into Amlogic mask-rom USB mode: hold the wheel-click button while plugging in USB (the host should see USB id `1b8e:c003`)
3. Run `flashthing-cli <path-to-zip>`

Flashing takes about 30-60 seconds for the first install. Subsequent updates use OTA over USB and don't need mask-rom mode.

If you're coming from the old Buildroot Nocturne, your Car Thing is already in good shape - the same `1b8e:c003` mask-rom mode works, just with a different host tool.

### Connecting to Nocturne

<details>
<summary><img src="https://camo.githubusercontent.com/b9c79d36777ba11fe5423f498b522f7b786898772a1ddbb44074fb6bc59adf06/68747470733a2f2f7573656e6f637475726e652e636f6d2f696d616765732f6c6f676f2e706e67" height="14" style="vertical-align: middle;"> Mobile Device (iOS 16.1+ / Android 13+, recommended)</summary>

Nocturne supports Bluetooth without tethering. An internet connection is still required to access the Spotify API. App access requires Nocturne Lifetime ($9.99 one-time) or Nocturne+ ($1.99/month). Nocturne+ also unlocks voice controls on your Car Thing.

1. Download [Nocturne Companion](https://usenocturne.com/app).
2. Follow the steps inside the app to pair your Car Thing.

**Tip:** Make sure your Car Thing is not connected to a computer, as this may conflict with Bluetooth.
</details>

<details>
<summary><img src="https://usenocturne.com/favicon.ico" height="14" style="vertical-align: middle;"> Standalone (WiFi, Raspberry Pi)</summary>

Nocturne Connector turns a Raspberry Pi into a Wi-Fi bridge for your Car Thing, so you can use Nocturne without being connected to your phone. The Connector source lives in this repo under [`packages/connector/`](packages/connector).

See [Building → Connector](#connector) for build instructions, or grab a prebuilt image from [Releases](https://github.com/usenocturne/nocturne/releases).
</details>

### Uninstall

Use a tool of your choice (`flashthing-cli` with stock firmware, or Terbium for the old Buildroot path) to flash stock or a different firmware.

## Donate

Nocturne is a massive endeavor, and the team has spent every day over the last year making it a reality out of our passion for creating something that people like you love to use.

All donations are split between the three members of the Nocturne team and go towards the development of future features. We are so grateful for your support!

[Donation Page](https://usenocturne.com/support)

## Building

Nocturne is a monorepo. Nocturne OS, nocturned (the on-device daemon), nocturne-ui (web UI written with Vite + React), and Nocturne Connector (the standalone Wi-Fi connector) all live in the same tree and build through the same `Justfile` at the repo root.

### Required host tools

| Tool | Why |
|---|---|
| [`just`](https://github.com/casey/just) | drives the recipes in the top-level and per-component `Justfile`s |
| [`cargo`](https://rustup.rs/) + [`cross`](https://github.com/cross-rs/cross) | builds the daemon, cross-compiled to aarch64 for the Car Thing |
| [`bun`](https://bun.sh/) | builds the device UI and the connector setup UI |
| `docker` or `podman` | runs the kas container for the image build |
| [`kas`](https://kas.readthedocs.io/) | invoked through `kas-container` |
| [`flashthing-cli`](https://crates.io/crates/flashthing-cli) | host-side burn-mode flasher |
| `uv` (optional) | runs the PEP-723 helper scripts under `image/scripts/` |

### The full image

```bash
just image-build              # default: nocturne-{prod,dev}-image + 4 OTA wrappers
```

The first cold build downloads upstream layers, crates, and tarballs (multiple gigabytes). Subsequent builds reuse `image/build/sstate-cache/` and `image/ccache/`. `yocto-superbird` exposes a public sstate mirror at `http://yocto.24hgr.love/sstate/` that primes most of the build for you.

Because the daemon and UI sources live in-tree, the image build picks them up directly via Yocto `EXTERNALSRC` - there is no separate "publish daemon, bump SRCREV, rebuild image" round trip when you're iterating.

Outputs land in `image/build/tmp/deploy/images/superbird/`:

- `nocturne-prod-image-superbird-flashthing.zip` - ext4 read-only rootfs, chromium kiosk
- `nocturne-dev-image-superbird-flashthing.zip` - squashfs-lz4 rootfs, weston desktop + VNC + tools-debug
- `nocturne-update-{prod,dev}-superbird.swu` - full A/B OTA payloads
- `nocturne-update-{prod,dev}-delta-superbird.swu` - zchunk delta OTA payloads
- `bandaid.ext4` - daemon + UI floor for the bandaid partition

### Daemon

```bash
just daemon-host              # cargo build for the dev host (no swupdate)
just daemon-build             # cross build for aarch64 + --features device
just daemon-copy              # daemon-build + scp to a running device at 172.16.42.2
just test                     # cargo test --workspace
just lint                     # cargo clippy --workspace -- -D warnings + cargo fmt --check
```

The daemon's vendored libswupdate IPC client lives at [`crates/swupdate-sys/vendor/`](crates/swupdate-sys/vendor) (LGPL-2.1-or-later, sbabic/swupdate@2024.12). It builds into a static library, so the daemon binary has no `libswupdate.so` runtime dependency outside the image's own.

### Device UI

```bash
just ui-dev                   # vite dev server (talks to a daemon on ws://localhost:5000)
just ui-build                 # static bundle (image build picks this up via EXTERNALSRC)
just ui-lint
```

### Connector

```bash
just connector-dev            # vite dev server for the setup UI
just connector-build          # builds the Pi OS image (see packages/connector/README.md)
```

### Codegen

The canonical wire schema lives in [`crates/shared/src/`](crates/shared/src). After any wire-protocol change:

```bash
just codegen                  # regenerate TS / Swift / Kotlin bindings under crates/shared/generated/
just codegen-check            # CI-style check that bindings are up to date
```

The generated bindings are consumed by `packages/ui/`, `packages/connector/`, and the (external) mobile app.

### Talking to a booted device

Over USB-CDC-NCM, the device shows up on mDNS as `nocturne.local`. The image's [`image/Justfile`](image/Justfile) ships the host-side recipes for talking to it:

```bash
just -f image/Justfile ssh                # interactive shell
just -f image/Justfile console start      # UART agent on /dev/ttyUSB0
just -f image/Justfile reboot-to-maskrom  # drop to 1b8e:c003 for full reflash
just -f image/Justfile flash              # full image via flashthing-cli
just -f image/Justfile ota                # delta OTA push to a booted device
```

The UART agent keeps FT232 RTS deasserted (it's wired to the SoC reset pin), so the board doesn't reset every time another process opens the serial node. Don't open `/dev/ttyUSB0` directly while the agent is running.

### OTA

OTAs are A/B with libswupdate. A successful install writes the inactive slot, flips `slot_active` in u-boot env, and reboots. If the new slot fails to come up three times the bootloader rolls back.

Three install kinds (driven by the companion app):

- `image` - writes a full `.swu` to the inactive root partition
- `daemon` - aarch64 `nocturned` binary rotated atomically on the bandaid bind-mount, service restart
- `builtin-webapp` - SPA bundle swapped on the bandaid bind-mount, service restart

Delta OTAs (zchunk) ship only the changed chunks via HTTP range requests over the USB link.

## Layout

| Path | What lives there |
|---|---|
| [`image/`](image) | The Yocto image. `kas/nocturne.yml` pins `yocto-superbird` upstream + adds `meta-nocturne/`. `image/Justfile` is the canonical command surface for image builds and device interaction. |
| [`crates/daemon/`](crates/daemon) | The `nocturned` Rust daemon. iAP2 / RFCOMM, OTA orchestration, embedded HTTP server serving the UI, WS to UI on `127.0.0.1:5000`. |
| [`crates/shared/`](crates/shared) | The canonical wire schema and generated TS/Swift/Kotlin bindings. |
| `crates/iap2/`, `crates/iap2-macros/`, `crates/iap2-mfi/` | iAP2 link/session layer + Identification CSM derive + MFi chip driver. |
| [`crates/swupdate-sys/`](crates/swupdate-sys) | Vendored libswupdate IPC client sources, built into a static lib by `cc::Build`. |
| [`tools/codegen/`](tools/codegen) | Wire-schema codegen for TS/Swift/Kotlin. Reads `crates/shared/src/`, writes `crates/shared/generated/`. |
| [`packages/ui/`](packages/ui) | React 19 + Vite kiosk app served by Chromium on the Car Thing (480x800). |
| [`packages/connector/`](packages/connector) | Raspberry Pi OS image that bridges Wi-Fi to the Car Thing. Bun + Elysia server + Vite + React setup UI. |

The mobile companion app, the website, the OTA server, and the backend API for AI and payments are private and live in their own repositories. Anything that ships inside the firmware lives here; anything that's a remote service that Nocturne talks to does not.

## Credits

This software was made possible only through the following individuals and open source projects:

- [Brandon Saldan](https://github.com/brandonsaldan)
- [Neel Patel](https://github.com/68p)
- [Dominic Frye](https://github.com/itsnebulalol)
- [Joey Eamigh](https://github.com/JoeyEamigh) - yocto-superbird / bridgething developer

<hr>

We'd like to give a huge thanks to [Joey Eamigh](https://github.com/JoeyEamigh) for [bridgething](https://github.com/JoeyEamigh/bridgething) (protocol, more robust iAP2, OTA, and more), [yocto-superbird](https://github.com/JoeyEamigh/yocto-superbird), and for a ton of help during the Yocto migration. We'd also like to thank [lmore377](https://github.com/lmore377) for modernizing the Car Thing's tooling and contributions to bridgething/yocto-superbird. The new Nocturne OS image powered by Yocto and modern software wouldn't be possible without them.

- [The Yocto Project](https://www.yoctoproject.org/) and [OpenEmbedded](https://www.openembedded.org/)
- [Benjamin McGill](https://www.linkedin.com/in/benjamin-mcgill/), for providing Brandon a Car Thing
- [bishopdynamics](https://github.com/bishopdynamics), for the original [superbird-tool](https://github.com/bishopdynamics/superbird-tool), [superbird-debian-kiosk](https://github.com/bishopdynamics/superbird-debian-kiosk), and modifying [aml-imgpack](https://github.com/bishopdynamics/aml-imgpack)
- [Thing Labs' fork of superbird-tool](https://github.com/thinglabsoss/superbird-tool), for their contributions on the original superbird-tool

## License

This project is licensed under the **GPL-3.0** license.

We kindly ask that any modifications or distributions made outside of direct forks from this repository include attribution to the original project in the README, as we have worked hard on this. :)

This software contains calls to the Nocturne API. Any use, distribution, or modification of this software constitutes acceptance of the Nocturne API License.

---

> © 2026 Vanta Labs.

> "Spotify" and "Car Thing" are trademarks of Spotify AB. This software is not affiliated with or endorsed by Spotify AB.

> [usenocturne.com](https://usenocturne.com) &nbsp;&middot;&nbsp;
> [GitHub](https://github.com/usenocturne) &nbsp;&middot;&nbsp;
> [X](https://x.com/usenocturne) &nbsp;&middot;&nbsp;
> [Discord](https://discord.gg/mnURjt3M6m)
