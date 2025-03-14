#!/bin/sh

mkdir -p "$ROOTFS_PATH"/boot
cp "$RES_PATH"/kernel/output/Image "$RES_PATH"/kernel/output/dtbs/superbird.dtb "$ROOTFS_PATH"/boot/
