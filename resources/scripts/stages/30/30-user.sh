#!/bin/sh

chroot_exec adduser -D -g "Nocturne User" -h /data/user nocturne nocturne
chroot_exec adduser nocturne video
chroot_exec adduser nocturne input
chroot_exec adduser nocturne seat

cp -a "$ROOTFS_PATH"/data/user "$DATAFS_PATH"/
rm -rf "$ROOTFS_PATH"/data/user

