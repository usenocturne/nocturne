#!/bin/sh

ln -fs /data/etc/timezone "$ROOTFS_PATH"/etc/timezone
ln -fs /data/etc/localtime "$ROOTFS_PATH"/etc/localtime

ln -fs /data/etc/hostname "$ROOTFS_PATH"/etc/hostname
ln -fs /data/etc/network/interfaces "$ROOTFS_PATH"/etc/network/interfaces
