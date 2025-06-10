#!/bin/sh

github_releases -r usenocturne/nocturned -a nocturned -v "$NOCTURNED_TAG"
install ./nocturned "$ROOTFS_PATH"/usr/sbin/nocturned
cp -a "$RES_PATH"/scripts/services/nocturned "$ROOTFS_PATH"/etc/sv/

mkdir -p "$ROOTFS_PATH"/etc/nocturne

echo "$NOCTURNE_IMAGE_VERSION" > "$ROOTFS_PATH"/etc/nocturne/version.txt

# DEFAULT_SERVICES="${DEFAULT_SERVICES} nocturned"
