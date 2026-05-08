#!/bin/sh

"$HELPERS_PATH"/chroot_exec.sh apk add libstdc++ libgcc

BUN_ARCHIVE="bun-linux-aarch64-musl"
BUN_TMPDIR="${WORK_PATH}/bun-dl"

mkdir -p "$BUN_TMPDIR"
curl -fL "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${BUN_ARCHIVE}.zip" \
  -o "${BUN_TMPDIR}/${BUN_ARCHIVE}.zip"
unzip -o "${BUN_TMPDIR}/${BUN_ARCHIVE}.zip" -d "$BUN_TMPDIR"
install -m 755 "${BUN_TMPDIR}/${BUN_ARCHIVE}/bun" "$ROOTFS_PATH"/usr/bin/bun
rm -rf "$BUN_TMPDIR"

[ -f "$ROOTFS_PATH/usr/bin/bun" ] || { echo "ERROR: bun binary not found after install"; exit 1; }
color_echo "  Installed Bun v${BUN_VERSION} (aarch64-musl)" -Green

mkdir -p "$ROOTFS_PATH"/etc/nocturne-connector/api

cp -r "$CONNECTOR_PATH"/server "$ROOTFS_PATH"/etc/nocturne-connector/api/server

mkdir -p "$ROOTFS_PATH"/etc/nocturne-connector/api/dist/client
cp -r "$CONNECTOR_PATH"/dist/client/* "$ROOTFS_PATH"/etc/nocturne-connector/api/dist/client/

cp -r "$CONNECTOR_PATH"/node_modules "$ROOTFS_PATH"/etc/nocturne-connector/api/node_modules

cp "$CONNECTOR_PATH"/package.json "$ROOTFS_PATH"/etc/nocturne-connector/api/package.json
cp "$CONNECTOR_PATH"/tsconfig.json "$ROOTFS_PATH"/etc/nocturne-connector/api/tsconfig.json

install -m 755 "$SCRIPTS_PATH"/services/connector-api.sh "$ROOTFS_PATH"/etc/init.d/connector-api
install -m 755 "$SCRIPTS_PATH"/services/wifi-import.sh "$ROOTFS_PATH"/etc/init.d/wifi-import

echo "$CONNECTOR_IMAGE_VERSION" > "$ROOTFS_PATH"/etc/nocturne-connector/version

mkdir -p "$ROOTFS_PATH"/boot

DEFAULT_SERVICES="${DEFAULT_SERVICES} connector-api"
BOOT_SERVICES="${BOOT_SERVICES} wifi-import"
