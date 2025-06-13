#!/bin/sh

xbps-install -r "$ROOTFS_PATH" -y openssh

cp "$RES_PATH"/config/sshd_config "$ROOTFS_PATH"/etc/sshd_config

rm -rf "$ROOTFS_PATH"/etc/ssh
ln -sf /var/local/etc/ssh "$ROOTFS_PATH"/etc/ssh

DEFAULT_SERVICES="${DEFAULT_SERVICES} sshd"
