#!/bin/sh

curl -L https://repo-default.voidlinux.org/live/current/void-armv7l-ROOTFS-"$VOID_BUILD".tar.xz | tar -xJ -C "$ROOTFS_PATH"

xbps-install -r "$ROOTFS_PATH" -Suy xbps
xbps-install -r "$ROOTFS_PATH" -uy
xbps-install -r "$ROOTFS_PATH" -y base-files coreutils findutils diffutils dash bash grep gzip file sed mawk less \
  util-linux which tar shadow e2fsprogs dosfstools procps-ng iproute2 iputils kmod eudev runit-void ifupdown curl nano

{
  echo "ignorepkg=wifi-firmware"
  echo "ignorepkg=iw"
  echo "ignorepkg=wpa_supplicant"
} >> "$ROOTFS_PATH"/etc/xbps.d/ignore.conf
