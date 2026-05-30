# Nocturne (Yocto image)

This is the **Yocto-based** Nocturne firmware for the Spotify Car Thing.

## Repo shape

| Dir | Purpose |
|---|---|
| `meta-nocturne/` | application layer (recipes, image defs, distro conf). Depends on `meta-superbird` for BSP. |
| `kas/nocturne.yml` | kas config — pins `yocto-superbird` upstream by commit + adds `meta-nocturne` |
| `kas/nocturne-local.example.yml` | template for `externalsrc` against unpushed `nocturned` / `nocturne-ui` checkouts. Copy → `nocturne-local.yml` (gitignored) → edit the two `NOCTURNE_LOCAL_*` paths. |
| `scripts/` | host helpers (`nocturne-{ssh,console,reset-hold,boot-kernel,flash-fast,…}`). PEP-723 metadata in the Python ones — `uv` runs them. |
| `Justfile` | **canonical command surface**. `just -l` always lists current verbs. |

## Build / lint / test

```bash
just build                 # default = nocturne (prod+dev images + 4 OTA wrappers)
just build nocturne-local  # use unpushed nocturned + nocturne-ui via externalsrc
just shell                 # bitbake shell inside the kas container
just lint                  # pre-commit: shellcheck + shfmt + yamllint
```

Requires `docker` or `podman` + `kas` + `just`. First cold build downloads ~gigabytes; public sstate mirror at `http://yocto.24hgr.love/sstate/` primes most of it (configured in upstream `yocto-superbird/kas/base.yml`).

**Outputs land in `build/tmp/deploy/images/superbird/`** — note the path is `superbird/`, not `nocturne/` (that's the MACHINE name, BSP-owned, do not rename).

There is no host-side test suite. Verification is "build the image, flash it, drive the device". Static checks: `just lint` and `bitbake -p` (recipe parse) inside `just shell`.

## Conventions that bite

**`superbird` vs `nocturne` naming.** The BSP machine name, distro inheritance, deploy directory, and all `SUPERBIRD_*` variables stay `superbird` — they're BSP-owned. We override *values* of those vars in `meta-nocturne/conf/distro/nocturne.conf` (e.g. `SUPERBIRD_HOSTNAME = "nocturne"`), never the var names. Host scripts deploy from `build/tmp/deploy/images/superbird/` and artifact filenames are `nocturne-*-superbird-flashthing.zip`. Don't "fix" that.

**Recipe filename = PV.** When bumping `nocturned` etc., rename `nocturned_2.0.4.bb` → `nocturned_2.0.5.bb` and update `SRCREV`. **Do not set `PV =` inside the recipe** — bitbake derives it from the filename.

**Bandaid contents are deliberately small.** The bandaid partition (`/var/lib/bandaid/nocturne`, bind-mounted at `/opt/nocturne`) holds only `nocturned` + `nocturne-ui`, the two things that hot-swap via `applyUpdate { kind: daemon | builtin-webapp }`. Models, fonts, MFi rules, and the `nocturne-ab` helper go in **rootfs**. Default bandaid size is 192 MiB. See `nocturne-bandaid.bb`'s `BANDAID_PACKAGES`.

**Floor sync exists because of an OS-OTA gap.** Full SWU updates rewrite boot + rootfs only — the bandaid partition stays stale. `nocturne-floor-sync.service` runs on boot, compares `/etc/nocturne/floor-version` (baked into the rootfs at build time, see `nocturne-image-base.inc`'s `nocturne_version_postprocess`) vs `/var/lib/bandaid/nocturne/.floor-version`, and atomically re-seeds the bandaid from the rootfs floor on version mismatch. Don't remove or short-circuit this.

**`just build` (default) requires nocturned to be pushed to GitHub.** It fetches via `SRC_URI = "git://github.com/usenocturne/nocturned.git;...;tag=v…"` at the pinned `SRCREV`. If you have local-only commits in `~/Code/nocturne/nocturned`, use `just build nocturne-local` until you push.

**`do_compile[network] = "1"`** is set on the nocturned recipe so cargo can fetch the `iap2-rs` git dep at compile time. The build is *not* fully offline-reproducible. Sources mirrors would have to be set up explicitly if that matters.

## Where the daemon lives & what it expects on disk

`nocturned` runs from `/opt/nocturne/daemon/nocturned.current` (bandaid). It opens:

- WebSocket `127.0.0.1:5000` — UI ↔ daemon RPC
- HTTP `127.0.0.1:8080` — serves the SPA at `/opt/nocturne/webapps/ui/` (embedded axum + tower-http; replaces the old separate static-web-server)

It reads (these are hardcoded; don't try to make them configurable in recipes):

- `/etc/nocturne/config.json` (optional)
- `/etc/nocturne/version.json` (rendered at image build time)
- `/etc/nocturne/models/*.onnx` (from `nocturne-models` recipe)
- `/dev/apple_mfi` (from `nocturne-mfi` udev rule)
- `/sys/class/efuse/usid` (BSP-provided)
- `/sys/class/backlight/aml-bl/brightness` (BSP-provided)
- spawns `arecord` subprocess (so `alsa-utils` is an `RDEPENDS`)

Build-time DEPENDS for the OTA-enabled daemon are `dbus libopus swupdate clang-native`. The recipe exports `LIBCLANG_PATH=${STAGING_LIBDIR_NATIVE}` and `BINDGEN_EXTRA_CLANG_ARGS=--sysroot=${RECIPE_SYSROOT}` so the `nocturne-swupdate-sys` bindgen build sees Yocto's libswupdate headers through the recipe sysroot.

## Device interaction

USB-CDC-NCM brings the device up as `nocturne.local` over mDNS. UART is `/dev/ttyUSB0` with RTS wired to the SoC reset line — open via `just console start` (long-lived agent that deasserts RTS), never directly with picocom/minicom while the agent runs.

```bash
just ssh                # interactive shell
just console start && just cmd 'dmesg | tail -30' && just console stop
just reboot-to-maskrom  # drop to 1b8e:c003 for full flashthing-cli reflash
just flash              # full image via flashthing-cli
just ota                # delta OTA push to a booted device
```

## libnocturne lib/core split (added during OTA bridgething port)

`nocturned` is now a cargo workspace with these members:

| Crate | Path | Purpose |
|---|---|---|
| `libnocturne` | `lib/` | wire types + framing layer + protocol codec. Crosses BT or WS boundaries. |
| `nocturne-swupdate-sys` | `swupdate-sys/` | bindgen FFI to libswupdate IPC. Host-stub fallback when libclang unavailable. |
| `nocturned` (the binary) | `bin/` | daemon, handlers, drivers. Imports lib for wire types. |
| `nocturne-codegen` | `tools/codegen/` | walks lib types, emits `lib/{ts,swift,kotlin}/` bindings via ts-rs + typeshare. |

**Lib rules** (mirrors bridgething's CLAUDE.md):

- Wire types live in `lib/`. Anything that crosses BT or WS boundaries.
- No `tokio` runtime types in `lib/` (no `tokio::sync::mpsc`, `tokio::task`). Only `tokio_util::codec` is allowed because it's the framing codec.
- No daemon state, handlers, drivers in `lib/`. Those are `bin/`.
- Only protocol deps in `lib/Cargo.toml`: `serde`, `ts-rs`, `typeshare`, `uuid`, `serde_with`, `derive_more`, `tokio-util`, `flate2`, `rmp-serde`. Anything else means you're putting daemon logic in lib by accident.
- `nocturne-codegen` outputs `lib/{ts,swift,kotlin}/` -- generated files are never hand-edited. Run `just codegen` after touching any lib type.
- Workspace deps are pinned with `=` versions to keep the wire ecosystem reproducible.
- Workspace `[workspace.dependencies]` entries can NOT specify features; each member's `[dependencies]` re-declares features as needed. Learned at T1.01.

When bumping the nocturned recipe filename to `nocturned_X.Y.Z.bb`, update `version` in `[workspace.package]` of root `Cargo.toml` to match, unless the Yocto bump is explicitly forward-looking while waiting for a daemon branch/tag. The OTA bring-up recipe is `nocturned_2.1.0.bb` while nocturned's Cargo workspace remains at `2.0.4` until the OTA branch is merged and tagged.

## OTA stack notes

- `nocturne-swupdate-sys` is built for device images with Yocto-provided `swupdate` headers and `clang-native`; keep the `LIBCLANG_PATH` and `BINDGEN_EXTRA_CLANG_ARGS` exports in the recipe when touching bindgen or vendoring behavior.
- The daemon recipe appends `--features device` to `CARGO_BUILD_FLAGS`; host/dev cargo checks can keep using the default host-stub path.
- `swupdate-config.bbappend` layers Nocturne's public key and accepted selectors on top of the BSP `swupdate-config` recipe. The BSP owns the baseline `swupdate.service` packaging and auto-enable behavior.
- `just publish` stages artifacts from `build/tmp/deploy/images/superbird/`, writes a per-version manifest, and copies them into `NOCTURNE_OTA_IMAGES_DIR` (default `~/Code/nocturne/nocturne-ota/images`). Required env: `NOCTURNE_RELEASE_VERSION`. Useful overrides: `NOCTURNE_DEPLOY_DIR`, `NOCTURNE_PUBLISH_STAGE`, `NOCTURNE_OTA_IMAGES_DIR`; remote SSH publish is intentionally TODO until signing keys and host/user details are provisioned.
