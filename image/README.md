# Nocturne OS image

The Yocto image for the Car Thing. `kas/nocturne.yml` pins the [`yocto-superbird`](https://github.com/JoeyEamigh/yocto-superbird) BSP upstream and adds [`meta-nocturne/`](meta-nocturne).

This document covers building the image and driving a device from a host. For flashing a release, connecting your phone, and the rest of the project see the [root README](../README.md). Layer internals are documented in [`meta-nocturne/README.md`](meta-nocturne/README.md).

Everything here runs from `image/`. The root `Justfile` wraps the common recipes (`just image-build`, `just release-image`) if you'd rather stay at the top level.

## Building

### Required host tools

| Tool | Why |
|---|---|
| [`just`](https://github.com/casey/just) | drives the recipes in the `Justfile` |
| `docker` or `podman` | runs the kas container |
| [`kas`](https://kas.readthedocs.io/) | invoked through `kas-container` |
| [`flashthing-cli`](https://crates.io/crates/flashthing-cli) | host-side burn-mode flasher |
| `uv` (optional) | runs the PEP-723 helper scripts under [`scripts/`](scripts) |

### One-shot build

```bash
just build
KAS_CONTAINER_ENGINE=podman just build   # if you don't run docker
```

The first cold build downloads upstream layers, crates, and tarballs (multiple gigabytes). Subsequent builds reuse `build/sstate-cache/` and `ccache/`. `yocto-superbird` exposes a public sstate mirror at `http://yocto.24hgr.love/sstate/` that primes most of the build for you.

Outputs land in `build/tmp/deploy/images/superbird/`:

- `nocturne-prod-image-superbird-flashthing.zip` - ext4 read-only rootfs, chromium kiosk
- `nocturne-dev-image-superbird-flashthing.zip` - squashfs-lz4 rootfs, weston desktop + VNC + tools-debug
- `nocturne-update-{prod,dev}-superbird.swu` - full A/B OTA payloads
- `nocturne-update-{prod,dev}-delta-superbird.swu` - zchunk delta OTA payloads
- `bandaid.ext4` - nocturned + nocturne-ui floor for the bandaid partition

### Signing

Production builds are signed and fail before BitBake starts when the private key is missing or does not match the public key baked into the image. For local testing only, build explicitly unsigned artifacts with:

```bash
NOCTURNE_SWUPDATE_SIGNING_MODE=development-unsigned just build
```

Unsigned artifacts cannot pass the production publisher.

### Build IDs

The build command prints the generated `NOCTURNE_BUILD_ID`. It is exactly 14 decimal UTC timestamp digits in `YYYYMMDDhhmmss` shape. That same identifier is embedded in the image, both SWUs, and the bandaid floor marker. Set `NOCTURNE_BUILD_ID` explicitly only when reproducing a known build; changing it invalidates the relevant BitBake task hashes so image and wrapper versions cannot drift. Both the host command and BitBake reject any other shape so the image, OTA server, floor sync, and daemon use one ordering policy.

### Iterating on the daemon or UI

`nocturned` and `nocturne-ui` are built from this repo, so the default `just build` needs your changes pushed. While they're still local, build from the working tree instead:

```bash
just build nocturne-local
```

No setup — the Justfile mounts the monorepo root at `/monorepo` and `kas/nocturne-local.yml` points `EXTERNALSRC` there, so the same committed config works on every machine. Both recipes compile inside the kas container (cargo for the daemon, `bun-native` for the UI); nothing has to be prebuilt on the host.

Note the container's `bun install` writes `node_modules/` into your tree, so don't run a host `bun install` at the same time as a local image build.

## Talking to a booted device

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

Reflashing a development device:

```bash
just reboot-to-maskrom  # drop to 1b8e:c003
just flash              # full image via flashthing-cli
just flash-env          # env-only reflash, much faster
just ota                # delta OTA push to a booted device
```

## Releasing

Image release manifests contain a signed full SWU fallback and a signed delta SWU with an explicit source-version compatibility list. Full SWUs stream zstd-compressed boot and rootfs members directly into the inactive slot. Delta OTAs use zchunk HTTP range requests for changed chunks only. The publisher rejects a release-version mismatch, a missing canonical zchunk asset, an unresolved `nocturne://` reference, or an unsigned production SWU.

The v2 OTA server reads releases from `images/<version>/<kind>/manifest.json` and `images/<version>/<kind>/assets/`. Image and bandaid release commands export OTA-server-ready trees at `build/nocturne-publish/<version>/<kind>/`. `release-bandaid` stops at that export and never writes into `nocturne-ota/images`; the exported version directory is ready for the deployment system to install under the server's `images/` root. The image publisher also copies its release into `../nocturne-ota/images` by default. Set `NOCTURNE_PUBLISH_STAGE` to choose the shared export root. Exporting one kind preserves other kinds at the same version. There is no R2 manifest generation step in this workflow.

The end-to-end recipe generates one UTC `+YYYYMMDDhhmmss` stamp and uses it for both the build and publish steps. Set `NOCTURNE_BUILD_ID` to reproduce a known build. The version core must match `DISTRO_VERSION`. Both `prod` and `dev` releases remain production-signed; the variant chooses which built image is published. Publishing an existing image version is rejected unless `NOCTURNE_ALLOW_REPLACE=1` is set deliberately.

Image publishing requires `bsdtar`, `openssl`, `python3`, and `rsync`. Component packaging additionally requires `bun`, `zstd`, and `file`.

```bash
# Preferred 4.1.0 end-to-end command, run from the monorepo root. The exact
# release version is the only delta source, so older image layouts get full.
VERSION_CORE=4.1.0
BUILD_ID=$(date -u +%Y%m%d%H%M%S)
NOCTURNE_BUILD_ID="$BUILD_ID" \
  just release-image "$VERSION_CORE" /secure/nocturne.pem \
  "${VERSION_CORE}+${BUILD_ID}" prod nocturne-local

# Or name every argument and use the pinned remote-source kas target.
NOCTURNE_BUILD_ID="$BUILD_ID" \
  just release-image "$VERSION_CORE" /secure/nocturne.pem \
  "${VERSION_CORE}+${BUILD_ID}" prod nocturne

# Lower-level publish-only path, run from image/ after building matching artifacts.
NOCTURNE_RELEASE_VERSION=4.1.0+20260725192800 \
NOCTURNE_DELTA_FROM_VERSIONS=4.1.0+20260725192800 \
NOCTURNE_SWUPDATE_PRIVATE_KEY=/secure/nocturne.pem \
just publish prod

# Compatibility wrapper for an already-built 4.1.0 image.
NOCTURNE_RELEASE_VERSION=4.1.0+20260725192800 \
NOCTURNE_DELTA_FROM_VERSIONS=4.1.0+20260725192800 \
just release prod
```

Component (hot) updates that don't require a full image:

```bash
just package-daemon ../target/aarch64-unknown-linux-gnu/release/nocturned build/ota-components/daemon
just package-ui ../packages/ui/dist build/ota-components/builtinWebapp
just package-bandaid ../target/aarch64-unknown-linux-gnu/release/nocturned ../packages/ui/dist build/ota-components/bandaid
just publish-component bandaid 4.2.0+20260725192800 build/ota-components/bandaid 4.1.0+20260718120000 stable

# Preferred end-to-end command, run from the monorepo root. It builds both inputs.
# The finished release is exported under image/build/nocturne-publish/<version>/bandaid/.
NOCTURNE_BUILD_ID=20260725192800 just release-bandaid 4.2.0 4.1.0+20260718120000 stable
```

## Justfile reference

```
$ just -l
Available recipes:
    boot-kernel                             # Exit mask-rom usb mode and cold-boot into the on-disk image.
    build target=default                    # Build the named image set inside the kas container.
    build-nocturned target="nocturne-local" # Build just the daemon recipe.
    cdp port="9223"                         # SSH-tunnel chromium's CDP from the device's 127.0.0.1:9223 to the host.
    checkout target=default                 # Fetch/checkout layers
    clean-build                             # Wipe local bitbake output. Layer clones + ccache survive.
    cmd *args                               # Send a single command via the uart console agent.
    console subcmd="status"                 # UART console agent. Subcommand: start | stop | restart | status.
    flash image="nocturne-dev-image"        # Flash a full image to the device.
    flash-env image="nocturne-dev-image"    # Env-only reflash.
    flash-fast partlabel file=""            # Write a single gpt partition over u-boot fastboot.
    install-dev                             # Pull latest preview image from the public OTA manifest and flash it.
    install-prod                            # Pull latest stable image from the public OTA manifest and flash it.
    lint                                    # Run pre-commit hooks (shellcheck, shfmt, yamllint) across the tree.
    ota *args                               # Delta-OTA from a booted device.
    package-bandaid binary dist output=...  # Package a daemon and UI dist together for an atomic bandaid OTA.
    package-daemon binary output=...        # Package one AArch64 daemon binary for a daemon-only OTA.
    package-ui dist output=...              # Package a built UI dist directory for a builtinWebapp OTA.
    pre-commit-install                      # Install the pre-commit git hook so `git commit` runs the lint set.
    publish variant="prod"                  # Stage signed full + compatible delta release metadata.
    publish-component kind version ...      # Publish a packaged component directory through nocturne-ota.
    push-sstate                             # Push local sstate-cache to your team's rsync mirror.
    push-webapp local name=""               # Push a webapp bundle into /opt/nocturne/webapps/<name>/.
    reboot-to-fastboot                      # Reboot a running device into u-boot fastboot.
    reboot-to-maskrom                       # Reboot a running device into amlogic mask-rom usb mode (1b8e:c003).
    release *args                           # Compatibility wrapper for v2 image publishing.
    reset-hold                              # Hold the FT232 RTS line deasserted (reset released). Foreground.
    reset-pulse duration_ms="200"           # One-shot reset pulse.
    shell target=default                    # Drop into a bitbake shell inside the container.
    ssh *args                               # SSH into the device over USB-CDC-NCM.
    test                                    # Run host-side image helper tests.
    vscode-setup                            # Drop poky-layout symlinks under sources/ for the vscode bitbake extension.
```

## License

GPL-3.0, same as the rest of the monorepo. See the [root README](../README.md#license).
