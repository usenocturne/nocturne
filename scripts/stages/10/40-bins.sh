#!/bin/sh

cp "$RES_PATH"/stock-files/output/usr/bin/uenv "$ROOTFS_PATH"/usr/bin/uenv

cp "$SCRIPTS_PATH"/reset-data "$ROOTFS_PATH"/sbin/reset-data
cp "$SCRIPTS_PATH"/reset-settings "$ROOTFS_PATH"/sbin/reset-settings

chmod +x "$ROOTFS_PATH"/sbin/reset-data "$ROOTFS_PATH"/sbin/reset-settings "$ROOTFS_PATH"/usr/bin/uenv
