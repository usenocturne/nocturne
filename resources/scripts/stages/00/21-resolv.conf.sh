#!/bin/sh

echo "nameserver 1.1.1.1" > "$ROOTFS_PATH"/etc/resolv.conf
echo "nameserver 8.8.8.8" >> "$ROOTFS_PATH"/etc/resolv.conf
