#!/bin/sh

mkdir -p "$ROOTFS_PATH"/lib/modules
cp -r "$RES_PATH"/kernel/output/lib/modules/4.9.113 "$ROOTFS_PATH"/lib/modules/
