#!/bin/sh

install "$RES_PATH"/nocturned "$ROOTFS_PATH"/usr/sbin/nocturned
install "$RES_PATH"/scripts/services/nocturned.sh "$ROOTFS_PATH"/etc/init.d/nocturned

mkdir -p "$ROOTFS_PATH"/etc/nocturne
echo "3.0.0" > "$ROOTFS_PATH"/etc/nocturne/version.txt

DEFAULT_SERVICES="${DEFAULT_SERVICES} nocturned"
