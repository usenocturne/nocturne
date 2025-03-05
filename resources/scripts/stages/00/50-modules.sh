#!/bin/sh

mkdir -p "$ROOTFS_PATH"/lib/modules
tar -xavf "$RES_PATH"/modules.tar.zst -C "$ROOTFS_PATH"/lib/modules/
