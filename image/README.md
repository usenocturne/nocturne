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
  <a href="#subprojects">Subprojects</a> •
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

Nocturne Connector requires a Raspberry Pi, but allows you to use Nocturne without being connected to your phone.

See more on the [Nocturne Connector GitHub](https://github.com/usenocturne/nocturne-connector).
</details>

### Uninstall

Use a tool of your choice (`flashthing-cli` with stock firmware, or Terbium for the old Buildroot path) to flash stock or a different firmware.

## Donate

Nocturne is a massive endeavor, and the team has spent every day over the last year making it a reality out of our passion for creating something that people like you love to use.

All donations are split between the three members of the Nocturne team and go towards the development of future features. We are so grateful for your support!

[Donation Page](https://usenocturne.com/support)

## Building

Nocturne builds on the [`yocto-superbird`](https://github.com/JoeyEamigh/yocto-superbird) BSP, pulled in as a kas-managed dependency.

### Required host tools

| Tool | Why |
|---|---|
| [`just`](https://github.com/casey/just) | drives the recipes in the `Justfile` |
| `docker` or `podman` | runs the kas container |
| [`kas`](https://kas.readthedocs.io/) | invoked through `kas-container` |
| [`flashthing-cli`](https://crates.io/crates/flashthing-cli) | host-side burn-mode flasher |
| `uv` (optional) | runs the PEP-723 helper scripts under `scripts/` |

### One-shot build

```bash
just build              # default: nocturne-{prod,dev}-image + 4 OTA wrappers
```

The first cold build downloads upstream layers, crates, and tarballs (multiple gigabytes). Subsequent builds reuse `build/sstate-cache/` and `ccache/`. `yocto-superbird` exposes a public sstate mirror at `http://yocto.24hgr.love/sstate/` that primes most of the build for you.

```bash
KAS_CONTAINER_ENGINE=podman just build   # if you don't run docker
```

Outputs land in `build/tmp/deploy/images/superbird/`:

- `nocturne-prod-image-superbird-flashthing.zip` - ext4 read-only rootfs, chromium kiosk
- `nocturne-dev-image-superbird-flashthing.zip` - squashfs-lz4 rootfs, weston desktop + VNC + tools-debug
- `nocturne-update-{prod,dev}-superbird.swu` - full A/B OTA payloads
- `nocturne-update-{prod,dev}-delta-superbird.swu` - zchunk delta OTA payloads
- `bandaid.ext4` - nocturned + nocturne-ui floor for the bandaid partition

### Iterating on the daemon or UI

If you're hacking on [`nocturned`](https://github.com/usenocturne/nocturned) or [`nocturne-ui`](https://github.com/usenocturne/nocturne-ui) and don't want to push a tag every time, point the build at your local checkouts:

```bash
cp kas/nocturne-local.example.yml kas/nocturne-local.yml
# edit the two NOCTURNE_LOCAL_* paths
just build nocturne-local
```

### Justfile reference

```
$ just -l
Available recipes:
    boot-kernel             # Exit mask-rom usb mode and cold-boot into the on-disk image
    build target=default    # Build the named image set inside the kas container
    cdp port="9223"         # SSH-tunnel chromium's CDP from the device to the host
    checkout target=default # Fetch/checkout layers
    cmd *args               # Send a single command via the uart console agent
    console subcmd="status" # UART console agent. Subcommand: start | stop | restart | status
    flash image=...         # Flash a full image to the device
    flash-env image=...     # Env-only reflash (~2s vs 30-60s for full)
    flash-fast partlabel    # Write a single GPT partition over u-boot fastboot
    install-dev             # Pull latest dev image from OTA manifest and flash it
    install-prod            # Pull latest prod image from OTA manifest and flash it
    ota *args               # Push a delta OTA to a booted device
    publish variant=...     # Cut a release: bundles + manifest + R2 upload
    push-sstate             # Push local sstate-cache to your team's rsync mirror
    push-webapp local name  # Push a webapp bundle into /var/nocturne/webapps/<name>
    reboot-to-fastboot      # Reboot device into u-boot fastboot
    reboot-to-maskrom       # Reboot device into mask-rom USB (1b8e:c003)
    release *args           # Upload build artifacts to R2
    reset-hold              # Hold FT232 RTS deasserted (reset released)
    reset-pulse duration_ms # One-shot reset pulse
    shell target=default    # Drop into a bitbake shell inside the kas container
    ssh *args               # SSH into the device over USB-CDC-NCM
    vscode-setup            # Drop poky-layout symlinks under sources/
```

### Talking to a booted device

Over USB-CDC-NCM, the device shows up on mDNS as `nocturne.local`:

```bash
just ssh                # interactive shell
just ssh 'uname -a'     # one-shot
```

UART for pre-SSH boots or kernel panics:

```bash
just console start      # long-lived agent on /dev/ttyUSB0
just cmd 'dmesg | tail -30'
just console stop
```

The agent keeps FT232 RTS deasserted (it's wired to the SoC reset pin), so the board doesn't reset every time another process opens the serial node. Don't open `/dev/ttyUSB0` directly while the agent is running.

### OTA

OTAs are A/B with libswupdate. A successful install writes the inactive slot, flips `slot_active` in u-boot env, and reboots. If the new slot fails to come up three times the bootloader rolls back.

Three install kinds (driven by the companion app):

- `image` - writes a full `.swu` to the inactive root partition
- `daemon` - aarch64 `nocturned` binary rotated atomically on the bandaid bind-mount, service restart
- `builtin-webapp` - SPA bundle swapped on the bandaid bind-mount, service restart

Delta OTAs (zchunk) ship only the changed chunks via HTTP range requests over the USB link.

## Subprojects

Nocturne consists of several Git repos, all of which are public and open-source.

- [nocturne](https://github.com/usenocturne/nocturne) - this Yocto image
- [nocturne-ui](https://github.com/usenocturne/nocturne-ui) - Nocturne's web application written with Vite + React
- [nocturned](https://github.com/usenocturne/nocturned) - the local daemon: BlueZ + iAP2 + MFi + WebSocket UI bridge + embedded HTTP file server

## Credits

This software was made possible only through the following individuals and open source projects:

- [Brandon Saldan](https://github.com/brandonsaldan)
- [Neel Patel](https://github.com/68p)
- [Dominic Frye](https://github.com/itsnebulalol)
- [Joey Eamigh](https://github.com/JoeyEamigh) - yocto-superbird/bridgething developer

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
