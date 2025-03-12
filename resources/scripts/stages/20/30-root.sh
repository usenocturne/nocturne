#!/bin/sh

root_pw=$(mkpasswd -m sha-512 -s "$DEFAULT_ROOT_PASSWORD")
sed -i "/^root/d" "$ROOTFS_PATH"/etc/shadow
echo "root:${root_pw}:0:0:::::" >> "$ROOTFS_PATH"/etc/shadow
cp "$ROOTFS_PATH"/etc/shadow "$ROOTFS_PATH"/etc/shadow.alpine-builder
cp "$ROOTFS_PATH"/etc/shadow "$DATAFS_PATH"/etc/shadow
ln -fs /data/etc/shadow "$ROOTFS_PATH"/etc/shadow
