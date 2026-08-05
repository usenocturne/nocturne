# Nocturne (Yocto image)

This is the **Yocto-based** Nocturne firmware for the Spotify Car Thing.

## Repo shape

| Dir | Purpose |
|---|---|
| `meta-nocturne/` | application layer (recipes, image defs, distro conf). Depends on `meta-superbird` for BSP. |
| `kas/nocturne.yml` | kas config - pins the private `yocto-superbird` upstream over HTTPS by commit + adds `meta-nocturne` |
| `kas/nocturne-local.yml` | `externalsrc` overlay for building `nocturned` + `nocturne-ui` from the working tree. Committed and host-independent: the Justfile mounts the monorepo root at `/monorepo`, so there is nothing to copy or edit. |
| `meta-nocturne/recipes-core/nocturne-monorepo.inc` | the monorepo `SRC_URI`/`SRCREV`, `require`d by both recipes built from this tree. |
| `scripts/` | host helpers (`nocturne-{ssh,console,reset-hold,boot-kernel,flash-fast,…}`). PEP-723 metadata in the Python ones — `uv` runs them. |
| `Justfile` | **canonical command surface**. `just -l` always lists current verbs. |

## Build / lint / test

```bash
just build                 # signed prod+dev images and 4 OTA wrappers
NOCTURNE_SWUPDATE_SIGNING_MODE=development-unsigned just build # explicit local-only mode
just build nocturne-local  # rebuild the local UI, then use it and local nocturned via externalsrc
just shell                 # bitbake shell inside the kas container
just test                  # host-side image helper tests
just lint                  # pre-commit: shellcheck + shfmt + yamllint
```

Requires `docker` or `podman` + `kas` + `just` + GitHub HTTPS credentials for the private `yocto-superbird` repo. Set `NETRC_FILE` to a netrc with GitHub repo access, or keep it at `$HOME/.netrc` for the Justfile default. First cold build downloads ~gigabytes; public sstate mirror at `http://yocto.24hgr.love/sstate/` primes most of it (configured in upstream `yocto-superbird/kas/base.yml`).

**Outputs land in `build/tmp/deploy/images/superbird/`** — note the path is `superbird/`, not `nocturne/` (that's the MACHINE name, BSP-owned, do not rename).

The host-side suite covers release helper invariants such as bandaid floor version ordering. Run `just test` and `just lint`, then use `bitbake -p` inside `just shell`. Final verification remains "build the image, flash it, drive the device".

## Conventions that bite

**`superbird` vs `nocturne` naming.** The BSP machine name, distro inheritance, deploy directory, and all `SUPERBIRD_*` variables stay `superbird` — they're BSP-owned. We override *values* of those vars in `meta-nocturne/conf/distro/nocturne.conf` (e.g. `SUPERBIRD_HOSTNAME = "nocturne"`), never the var names. Host scripts deploy from `build/tmp/deploy/images/superbird/` and artifact filenames are `nocturne-*-superbird-flashthing.zip`. Don't "fix" that.

**Recipe filename = PV.** When bumping `nocturned` etc., rename `nocturned_2.0.4.bb` → `nocturned_2.0.5.bb` and update `SRCREV`. **Do not set `PV =` inside the recipe** — bitbake derives it from the filename.

**Bandaid contents are deliberately small.** The bandaid partition (`/var/lib/bandaid/nocturne`, bind-mounted at `/opt/nocturne`) holds only `nocturned` + `nocturne-ui`, the two things that hot-swap via OTA kinds `daemon`, `builtinWebapp`, or combined `bandaid`. Models, fonts, and the `nocturne-ab` helper go in **rootfs**. Default bandaid size is 192 MiB. See `nocturne-bandaid.bb`'s `BANDAID_PACKAGES`.

**Floor sync exists because of an OS-OTA gap.** Full SWU updates rewrite boot + rootfs only - the bandaid partition stays stale. `/var/lib/bandaid/nocturne/.floor-version` is the canonical installed overlay version for both hot updates and floor sync. `nocturne-floor-sync.service` re-seeds only when `/etc/nocturne/floor-version` is newer. It follows SemVer core and prerelease ordering, then uses `+build` identifiers as a Nocturne build-order tie-breaker. An older rootfs cannot overwrite a newer hot update. Keep the comparison, atomic marker write, and rollback behavior together.

**Prod OTA rootfs size is fixed to the A/B slot.** Existing devices have 516 MiB `root_a` and `root_b` partitions. `nocturne-prod-image.bb` forces the standalone ext4 to `SUPERBIRD_ROOT_PART_SIZE` before mkfs and asserts the exact byte count before zchunk conversion. Full and delta OTAs both derive from that artifact. Do not add `IMAGE_ROOTFS_EXTRA_SPACE`, grow the slots, or move the check after image conversions; a payload that no longer fits must fail during mkfs.

**Mockingbird uses every Circular script variant.** `75-nocturne-circular.conf` assigns the otherwise unnamed Arabic, Cyrillic, Devanagari, Greek, and Hebrew Book/Bold files to `Circular Sp UI v3 T` during fontconfig scanning. Keep that mapping and the Latin Book/Bold files together. Mockingbird only requests weights 400 and 700, so Black variants are intentionally omitted from `SRC_URI`. `/var` is persistent across A/B updates, so `05-nocturne-ro-cachedir.conf` puts the authoritative fontconfig cache on the immutable rootfs ahead of the stale writable cache. Keep `${datadir}/fontconfig/cache` packaged with the font recipe.

**`just build` (default) requires this monorepo's changes to be pushed to GitHub.** Both `nocturned` and `nocturne-ui` fetch the workspace from `usenocturne/nocturne` (via `nocturne-monorepo.inc`) so Cargo and Bun see the same graph local builds use. Use `just build nocturne-local` while daemon or UI changes are still local.

**Declare the monorepo URL only in `nocturne-monorepo.inc`.** `kas/nocturne-local.yml`'s `SRC_URI:remove` lines reference `${NOCTURNE_MONOREPO_SRC_URI}` rather than restating the URL. Spelling it twice is what silently broke local builds before: the recipe moved to `nocturne-mono` while the removes still named `usenocturne/nocturned`, so they matched nothing and the git fetch survived into local builds. `:remove` values expand lazily in the recipe's datastore, so the indirection works without depending on anonymous-python ordering.

**The UI builds inside Yocto, not on the host.** `nocturne-ui` runs `bun install --frozen-lockfile` + `bun run ui:build` in `do_compile` against `bun-native`, exactly as `nocturned` runs cargo. Keep `bun-native`'s `PV` in step with `packageManager` in the root `package.json`. Nothing about the local path prebuilds a `dist/`. Keep `build-nocturned` daemon-only so `just daemon-deploy` stays fast.

**`do_compile[network] = "1"`** is set on the nocturned recipe so cargo can fetch the `iap2-rs` git dep at compile time. The build is *not* fully offline-reproducible. Sources mirrors would have to be set up explicitly if that matters.

## Where the daemon lives & what it expects on disk

`nocturned` runs from `/opt/nocturne/daemon/nocturned.current` (bandaid). It opens:

- WebSocket `127.0.0.1:5000` — UI ↔ daemon RPC
- HTTP `127.0.0.1:8080` — serves the SPA at `/opt/nocturne/webapps/ui/` (embedded axum + tower-http; replaces the old separate static-web-server)

It reads (these are hardcoded; don't try to make them configurable in recipes):

- `/etc/nocturne/config.json` (optional)
- `/etc/nocturne/models/*.onnx` (from `nocturne-models` recipe)
- the MFi auth coprocessor on `/dev/i2c-3` @ `0x10` (kernel i2c-dev; userspace driver in `nocturned` via the `iap2-mfi` crate, matching bridgething)
- `/etc/superbird` for identity/version metadata plus efuse nvmem cells under `/sys/bus/nvmem/devices/efuse0/cells/` (`serial-number@*`, `bt-mac@*`)
- display backlight through `/sys/class/backlight/*/brightness` discovered at runtime from sysfs
- ambient light through IIO sysfs devices, preferring `in_intensity0_raw` and falling back to `in_illuminance0_input`; `nocturned` sets TMD2772 integration time to `0.100` and gain to `16` at discovery because the kernel default is near-blind
- `nocturned.service` conflicts with `superbird-als.service` so only one process owns the backlight policy
- `nocturned.service` wants, but is deliberately not ordered after, `bluetooth.service`. HTTP and WebSocket startup must not wait for BlueZ or `hci0`.
- The daemon retries Bluetooth session initialization indefinitely with a capped 250 ms to 5 second backoff. This covers missing adapters, transient BlueZ errors, and later BlueZ restarts without delaying HTTP readiness.
- `chromium-kiosk.service` pulls in `nocturned.service` and probes `127.0.0.1:8080` every 500 ms for up to 30 seconds before launching Chromium. Keep the HTTP readiness probe: `After=nocturned.service` alone is insufficient because the daemon is `Type=simple`, and Cast Shell does not retry an initial failed navigation.
- spawns `arecord` against ALSA `hw:0,0` after routing TODDR_A/B to PDM `IN 4` (so `alsa-utils` is an `RDEPENDS`)

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

When bumping the nocturned recipe filename to `nocturned_X.Y.Z.bb`, update `version` in `[workspace.package]` of root `Cargo.toml` to match. The daemon component is currently `2.1.0` in both places. That component version is independent from the firmware image's `DISTRO_VERSION` (`4.1.0` here); the image version and build ID come from the `/etc/superbird` metadata file and are what the daemon reports as its installed image lane.

## OTA stack notes

- `nocturne-swupdate-sys` is built for device images with Yocto-provided `swupdate` headers and `clang-native`; keep the `LIBCLANG_PATH` and `BINDGEN_EXTRA_CLANG_ARGS` exports in the recipe when touching bindgen or vendoring behavior.
- The daemon recipe appends `--features device` to `CARGO_BUILD_FLAGS`; host/dev cargo checks can keep using the default host-stub path.
- `swupdate-config.bbappend` installs Nocturne's runtime configuration at `/etc/swupdate.cfg`. Do not put libconfig files in `/etc/swupdate/conf.d`: the BSP startup script sources that directory as shell. The BSP still owns the service packaging and auto-enable behavior.
- The layer-local `swupdate-progress.service` intentionally runs `swupdate-progress -w` without `-r`. A successful full image OTA stages the inactive slot, cleans daemon OTA state, emits `ota.complete`, and waits for the user to select Restart in the settings UI. Do not restore automatic reboot behavior.
- `20-nocturne-version-policy` passes the running rootfs image version from `/etc/nocturne/floor-version` through SWUpdate's valid `--no-downgrading` and `--no-reinstalling` options. Never use the bandaid marker for this native image check because an image SWU does not replace that partition. The pinned SWUpdate 2025.12 ignores SemVer `+build` metadata for precedence, so this protects core/prerelease ordering and exact reinstalls while the OTA server and daemon enforce Nocturne's build-identifier tie-break. Do not use the unrecognized `no-downgrade-check` libconfig key.
- Production is the default and fails closed unless `NOCTURNE_SWUPDATE_PRIVATE_KEY` points to the RSA key matching `meta-nocturne/recipes-core/nocturne-keys/files/nocturne.pem`. Use `NOCTURNE_SWUPDATE_SIGNING_MODE=development-unsigned` only for artifacts that cannot be released.
- Signed full and delta descriptions come from `recipes-extended/nocturne-update/files/{full,delta}`. Every image entry must keep its adjacent `$swupdate_get_sha256(...)` declaration pointed at the exact staged CPIO member. SWUpdate 2025.12 rejects a signed container if any installed image lacks a valid authenticated hash, and `nocturne-publish` independently verifies those hashes against the final archive bytes.
- Full SWUs stage zstd-compressed boot and rootfs bytes under the stable `boot.vfat` and `system.img` CPIO names. Their descriptions must retain `compressed = "zstd"`, `type = "raw"`, and `installed-directly = true`; hashes cover the compressed members. Delta headers and zchunk assets are not wrapped in this compression path.
- Image, SWU, manifest, and bandaid floor versions use the same build-stamped form, such as `4.1.0+20260725192800`. `NOCTURNE_BUILD_ID` is exactly 14 decimal UTC timestamp digits in `YYYYMMDDhhmmss` shape; the host build, BitBake, publisher, and daemon all reject other shapes. `just build` creates one ID and passes it to every target; the variable participates in task hashes so an incremental SWU build cannot reuse an image with a different installed version. Override it only to reproduce a known build, including through `release-image` or `release-bandaid`. This prevents a successfully installed rebuild from being offered forever and permits a later build of the same release core.
- `just publish` requires both full and delta SWUs, verifies their exact build-stamped release version and production signature, copies canonical `boot.vfat.zck` and `system.img.zck` names, and verifies every `nocturne://` delta reference. Set `NOCTURNE_RELEASE_VERSION` to the full version and `NOCTURNE_DELTA_FROM_VERSIONS` to a comma-separated list of exact compatible installed builds, or `*` only when every earlier version is compatible. Delta source entries must be valid SemVer versions. The builder export is an OTA-server-ready tree at `build/nocturne-publish/<version>/image/`; `NOCTURNE_PUBLISH_STAGE` changes that export root without removing the version and kind directories. Existing image-version directories are immutable by default; set `NOCTURNE_ALLOW_REPLACE=1` only for an intentional replacement. The manifest publishes a full fallback and a compatible delta variant. From the monorepo root, prefer `just release-image <version-core> <signing-key> [delta-from-versions] [variant] [target]`; it generates one UTC build ID, forces production signing, defaults to the `nocturne-local` kas target so the current daemon/UI sources are included, and publishes the resulting exact image version without requiring release environment variables. Pass `nocturne` as the final argument to build the pinned remote sources instead. The `just release` compatibility wrapper delegates to the same v2 publisher and reads the SWU version when no version variable is supplied.
- `just package-daemon`, `just package-ui`, and `just package-bandaid` create the three hot-update payload shapes. `just publish-component <kind> <version> <source> <minimum-image-version> [channel]` promotes one of them through the OTA server publisher. From the monorepo root, `just release-bandaid <version-core> <minimum-image-version> [channel]` is the preferred end-to-end path: it creates a build-stamped version, builds both inputs, packages them in a fresh temporary directory, exports the finished release to `build/nocturne-publish/<version>/bandaid/`, and verifies the exported asset and manifest. It must not write into `nocturne-ota/images`; deployment consumes the exported tree separately. `NOCTURNE_PUBLISH_STAGE` changes the shared image and bandaid export root. The minimum image version is mandatory so an older device can be routed through a full or zchunk image prerequisite before the hot update. Image and component releases use separate `<version>/<kind>/` directories so both can exist at one product version, and refreshing one exported kind must preserve its siblings.
