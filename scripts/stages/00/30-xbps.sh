#!/bin/sh

curl -L https://repo-default.voidlinux.org/live/current/void-armv7l-ROOTFS-"$VOID_BUILD".tar.xz | tar -xJ -C "$ROOTFS_PATH"

xbps-install -r "$ROOTFS_PATH" -Suy xbps
xbps-install -r "$ROOTFS_PATH" -uy
xbps-install -r "$ROOTFS_PATH" -y base-system

{
  echo "ignorepkg=wifi-firmware"
  echo "ignorepkg=iw"
  echo "ignorepkg=wpa_supplicant"
} >> "$ROOTFS_PATH"/etc/xbps.d/ignore.conf

xbps-remove -ROoy -r "$ROOTFS_PATH" wifi-firmware iw wpa_supplicant

xbps-install -r "$ROOTFS_PATH" -y ifupdown util-linux curl
