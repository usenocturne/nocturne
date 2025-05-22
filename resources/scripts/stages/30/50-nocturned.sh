#!/bin/sh

github_releases -r usenocturne/nocturned -a nocturned -v "$NOCTURNED_TAG"
install ./nocturned "$ROOTFS_PATH"/usr/sbin/nocturned
install "$RES_PATH"/scripts/services/nocturned.sh "$ROOTFS_PATH"/etc/init.d/nocturned

mkdir -p "$DATAFS_PATH"/etc/nocturne

DEFAULT_SERVICES="${DEFAULT_SERVICES} nocturned"
