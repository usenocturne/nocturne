#!/bin/sh

curl -L https://repo-default.voidlinux.org/live/current/void-armv7l-ROOTFS-"$VOID_BUILD".tar.xz | tar -xJ -C "$ROOTFS_PATH"

xbps-install -r "$ROOTFS_PATH" -Suy xbps
xbps-install -r "$ROOTFS_PATH" -uy
xbps-install -r "$ROOTFS_PATH" -y base-files busybox-huge bash file util-linux shadow e2fsprogs dosfstools \
  procps-ng iproute2 iputils kmod eudev runit-void ifupdown curl

{
  echo "ignorepkg=wifi-firmware"
  echo "ignorepkg=iw"
  echo "ignorepkg=wpa_supplicant"
} >> "$ROOTFS_PATH"/etc/xbps.d/ignore.conf

"$HELPERS_PATH"/chroot_exec.sh /bin/sh -c "
  for util in \$(/usr/bin/busybox --list); do
    [ ! -f \"/usr/bin/\$util\" ] && /usr/bin/busybox ln -sfv busybox \"/usr/bin/\$util\"
  done
  install -dm1777 /tmp
  xbps-reconfigure -fa
"

DEFAULT_SERVICES="${DEFAULT_SERVICES} busybox-ntpd"
