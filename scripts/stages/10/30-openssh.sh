#!/bin/sh

xbps-install -r "$ROOTFS_PATH" -y openssh

cp "$RES_PATH"/config/sshd_config "$ROOTFS_PATH"/etc/ssh/sshd_config

DEFAULT_SERVICES="${DEFAULT_SERVICES} sshd"
