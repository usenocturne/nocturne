#!/bin/sh

"$HELPERS_PATH"/github_releases.sh -r usenocturne/nocturned -a nocturned -v "$NOCTURNED_TAG" -d "$WORK_PATH"
rm -f nocturned nocturned.sha256
install "$WORK_PATH"/nocturned "$ROOTFS_PATH"/usr/sbin/nocturned
cp -a "$SCRIPTS_PATH"/services/nocturned "$ROOTFS_PATH"/etc/sv/

mkdir -p "$ROOTFS_PATH"/etc/nocturne

echo "$NOCTURNE_IMAGE_VERSION" > "$ROOTFS_PATH"/etc/nocturne/version.txt

DEFAULT_SERVICES="${DEFAULT_SERVICES} nocturned"
