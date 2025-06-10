#!/bin/sh

rm -f "$ROOTFS_PATH"/etc/resolv.conf
ln -fs /var/local/etc/resolv.conf "$ROOTFS_PATH"/etc/resolv.conf
