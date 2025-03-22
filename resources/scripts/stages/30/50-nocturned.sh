#!/bin/sh

github_releases -r usenocturne/nocturned -a nocturned
install ./nocturned "$ROOTFS_PATH"/usr/sbin/nocturned
install "$RES_PATH"/scripts/services/nocturned.sh "$ROOTFS_PATH"/etc/init.d/nocturned

mkdir -p "$ROOTFS_PATH"/etc/nocturne
printf "%s" "3.0.0" > "$ROOTFS_PATH"/etc/nocturne/version.txt

DEFAULT_SERVICES="${DEFAULT_SERVICES} nocturned"
