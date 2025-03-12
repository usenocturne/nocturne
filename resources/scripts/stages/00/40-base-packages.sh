#!/bin/sh

# initial package installation
apk --root "$ROOTFS_PATH" --update-cache --initdb --keys-dir=/usr/share/apk/keys-stable --arch "$ARCH" add \
  alpine-base cloud-utils-growpart coreutils e2fsprogs-extra \
  ifupdown-ng mkinitfs partx rng-tools-extra tzdata util-linux

if chroot_exec apk update; then
  chroot_exec apk upgrade --available
fi

# stop initramfs creation as not used
echo "disable_trigger=\"YES\"" > "$ROOTFS_PATH"/etc/mkinitfs/mkinitfs.conf
