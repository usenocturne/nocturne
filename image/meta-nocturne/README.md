# meta-nocturne

The Nocturne application layer. Sits on top of [`meta-superbird`](https://github.com/JoeyEamigh/yocto-superbird/tree/main/meta-superbird) and turns the bare BSP into a Nocturne device: the daemon, the SPA bundle, the wake-word models, the fonts, the MFi userspace glue, the OTA wrappers, and the prod/dev image recipes.

This layer is the only repo you actually need for the Nocturne image - everything else (kernel, u-boot, Chromium, Weston, swupdate, USB gadget, Bluetooth bring-up) comes from the BSP.

## Layer composition

```
LAYERDEPENDS_nocturne = "core superbird"
LAYERSERIES_COMPAT_nocturne = "scarthgap wrynose"
```

`core` is poky. `superbird` brings the BSP, which in turn brings `meta-meson` and `meta-browser/meta-chromium`.

The Nocturne distro inherits `conf/distro/superbird.conf` and overrides:

| Var | Value |
|---|---|
| `DISTRO` | `nocturne` |
| `DISTRO_NAME` | `Nocturne` |
| `SUPERBIRD_HOSTNAME` | `nocturne` (mDNS becomes `nocturne.local`) |
| `SUPERBIRD_MDNS_SERVICE_NAME` | `Nocturne` |
| `SUPERBIRD_USB_GADGET_*` | Nocturne identity strings |
| `CHROMIUM_KIOSK_URL` | `http://127.0.0.1:8080/` (served by nocturned itself) |

## Recipe map

| Recipe | What it does |
|---|---|
| `nocturned` | Rust daemon: BlueZ iAP2 + WebSocket UI bridge on `:5000` + MFi via `/dev/apple_mfi` + ALSA wake-word + embedded HTTP file server on `:8080` |
| `nocturne-ui` | Prebuilt React/Vite SPA, installed under the bandaid floor |
| `nocturne-models` | ONNX wake-word + mel-spectrogram models, rootfs-immutable |
| `nocturne-fonts` | Circular + Inter + Noto subset, rootfs-immutable |
| `nocturne-mfi` | udev rule + helpers that surface the Apple MFi chip at `/dev/apple_mfi` |
| `nocturne-bandaid` | Wraps `bandaid-image.bbclass` to produce `bandaid.ext4` (daemon + UI floor) |
| `nocturne-ab` | A/B slot debug helper - `nocturne-ab status` on device |
| `nocturne-floor-sync` | systemd one-shot: re-seeds the bandaid floor from rootfs on OS upgrade |
| `nocturne-keys` | Nocturne OTA public key installed at `/etc/nocturne.pem` for SWUpdate signature checks |
| `nocturne-state-dirs` | tmpfiles.d declarations for persistent OTA transfer state under `/var/lib/nocturne` |
| `nocturne-update-*` | Full + delta `.swu` wrappers for prod and dev images |
| `nocturne-prod-image` | ext4 read-only rootfs, chromium kiosk |
| `nocturne-dev-image` | squashfs-lz4 + weston desktop + VNC + tools-debug |
| `chromium-kiosk` (bbappend) | Wires `KIOSK_ENV_OVERRIDE_FILE=/opt/nocturne/kiosk-env` |
| `superbird-mdns` (bbappend) | Installs the Nocturne avahi service |
| `superbird-logo` (bbappend) | Ships the 480x800 Nocturne BMP shown by u-boot's `bmp display` |
| `fastfetch` (bbappend) | Swaps the BSP fastfetch config + logo for Nocturne's |
| `base-files` (bbappend) | Nocturne `/etc/motd` |

## Image variants

| Image | Rootfs | What's on it |
|---|---|---|
| `nocturne-prod-image` | ext4 ro | `packagegroup-nocturne-core` + chromium kiosk + weston kiosk-shell |
| `nocturne-dev-image` | squashfs-lz4 | the prod set + `packagegroup-nocturne-dev` (weston desktop, VNC, gdb, htop, strace, tcpdump, libgpiod-tools, evtest, …) |

## Bandaid and the floor sync

The bandaid partition holds `nocturned.current` and the SPA bundle. The opt-overlay systemd unit bind-mounts `/var/lib/bandaid/nocturne` at `/opt/nocturne`, so what the daemon actually executes is whatever the bandaid has - independent of the rootfs.

Full SWU updates only rewrite boot + rootfs, leaving the bandaid stale. `nocturne-floor-sync.service` runs on every boot, compares `/etc/nocturne/floor-version` (rendered at image build time) against `/var/lib/bandaid/nocturne/.floor-version`, and atomically re-seeds the bandaid from the rootfs floor when the rootfs is newer. This closes the gap so OS upgrades that ship newer factory defaults actually take effect.

Daemon-only and webapp-only updates bypass the rootfs entirely and rewrite the bandaid directly via the companion app's `applyUpdate { kind: daemon | builtin-webapp }`.

## Verifying the OTA stack ships

Do not run this on the host directly. Enter the kas/bitbake shell first, then inspect the image install set:

```bash
just shell
bitbake -e nocturne-prod-image | grep ^IMAGE_INSTALL
```

The `IMAGE_INSTALL` output should include `swupdate`, `swupdate-client`, `swupdate-tools`, `nocturne-keys`, and `nocturne-state-dirs` via `packagegroup-nocturne-core`.

## Adding a recipe

The layer follows the OE conventions you already know. Add `.bb` files under the appropriate `recipes-*/` subdirectory; matching files live in a sibling `files/` directory referenced via `file://` `SRC_URI`. Patches use `striplevel=1`. Init goes through systemd via `inherit systemd` + `SYSTEMD_SERVICE:${PN} = "foo.service"`.

If your recipe ships something that should hot-swap with `applyUpdate`, install it under `${nonarch_libdir}/nocturne/<vendor>/...` and add the recipe to `BANDAID_PACKAGES` in `nocturne-bandaid.bb`. Otherwise install to the rootfs.

## License

MIT (the layer scaffolding). The Nocturne userspace it pulls in (`nocturned`, `nocturne-ui`) is GPL-3.0.
