#!/bin/sh

cp "$SCRIPTS_PATH"/firstboot.sh "$ROOTFS_PATH"/etc/runit/core-services/02a-firstboot.sh
chmod +x "$ROOTFS_PATH"/etc/runit/core-services/02a-firstboot.sh

cp -a "$RES_PATH"/stock-files/output/usr/lib/modules/4.9.113 "$ROOTFS_PATH"/lib/modules/
