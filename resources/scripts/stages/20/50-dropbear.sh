#!/bin/sh

chroot_exec apk add dropbear openssh-sftp-server

rm -rf "$ROOTFS_PATH"/etc/dropbear
mkdir -p "$DATAFS_PATH"/etc/dropbear
ln -s /data/etc/dropbear "$ROOTFS_PATH"/etc/

mv "$ROOTFS_PATH"/etc/conf.d/dropbear "$ROOTFS_PATH"/etc/conf.d/dropbear_org
ln -s /data/etc/dropbear/dropbear.conf "$ROOTFS_PATH"/etc/conf.d/dropbear

if [ "$DEFAULT_DROPBEAR_ENABLED" != "true" ]; then
  echo 'DROPBEAR_OPTS="-p 127.0.0.1:22"' > "$ROOTFS_PATH"/etc/conf.d/dropbear_org
fi

cp "$ROOTFS_PATH"/etc/conf.d/dropbear_org "$DATAFS_PATH"/etc/dropbear/dropbear.conf

DEFAULT_SERVICES="${DEFAULT_SERVICES} dropbear"
