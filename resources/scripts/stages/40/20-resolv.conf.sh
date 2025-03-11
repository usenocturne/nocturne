#!/bin/sh

# create resolv.conf symlink for running system
ln -fs /data/etc/resolv.conf "$ROOTFS_PATH"/etc/resolv.conf
