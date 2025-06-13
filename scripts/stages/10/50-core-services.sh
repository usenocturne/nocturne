#!/bin/sh

cp "$SCRIPTS_PATH"/firstboot.sh "$ROOTFS_PATH"/etc/runit/core-services/02a-firstboot.sh
chmod +x "$ROOTFS_PATH"/etc/runit/core-services/02a-firstboot.sh

sed -i '/msg "Mounting rootfs read-write..."/s/^/#/' "$ROOTFS_PATH"/etc/runit/core-services/03-filesystems.sh
sed -i '/LIBMOUNT_FORCE_MOUNT2=always mount -o remount,rw \//s/^/#/' "$ROOTFS_PATH"/etc/runit/core-services/03-filesystems.sh
