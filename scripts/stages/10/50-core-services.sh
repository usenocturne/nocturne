#!/bin/sh

cp "$SCRIPTS_PATH"/firstboot.sh "$ROOTFS_PATH"/etc/runit/core-services/02a-firstboot.sh
chmod +x "$ROOTFS_PATH"/etc/runit/core-services/02a-firstboot.sh
