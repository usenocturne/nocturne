#!/bin/sh

cp "$SCRIPTS_PATH"/pre-init "$ROOTFS_PATH"/sbin/pre-init

cp "$SCRIPTS_PATH"/reset-data "$ROOTFS_PATH"/sbin/reset-data
cp "$SCRIPTS_PATH"/reset-settings "$ROOTFS_PATH"/sbin/reset-settings

chmod +x "$ROOTFS_PATH"/sbin/pre-init "$ROOTFS_PATH"/sbin/reset-data "$ROOTFS_PATH"/sbin/reset-settings
