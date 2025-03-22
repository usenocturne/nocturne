#!/bin/sh

# create resolv.conf symlink for running system
rm -f "$ROOTFS_PATH"/etc/resolv.conf
ln -fs /data/etc/resolv.conf "$ROOTFS_PATH"/etc/resolv.conf
