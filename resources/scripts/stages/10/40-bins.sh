#!/bin/sh

cp "$RES_PATH"/scripts/pre-init "$ROOTFS_PATH"/sbin/pre-init

cp "$RES_PATH"/scripts/reset-data "$ROOTFS_PATH"/sbin/reset-data
cp "$RES_PATH"/scripts/reset-settings "$ROOTFS_PATH"/sbin/reset-settings

chmod +x "$ROOTFS_PATH"/sbin/pre-init "$ROOTFS_PATH"/sbin/reset-data "$ROOTFS_PATH"/sbin/reset-settings
