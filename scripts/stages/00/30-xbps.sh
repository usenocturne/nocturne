#!/bin/sh

curl -L https://repo-default.voidlinux.org/live/current/void-armv7l-ROOTFS-"$VOID_BUILD".tar.xz | tar -xJ -C "$ROOTFS_PATH"

xbps-install -r "$ROOTFS_PATH" -Suy xbps
xbps-install -r "$ROOTFS_PATH" -uy
xbps-install -r "$ROOTFS_PATH" --repository "$RES_PATH"/xbps -y base-nocturne
xbps-remove -r "$ROOTFS_PATH" -Ry base-container-full

"$HELPERS_PATH"/chroot_exec.sh /bin/sh -c "
  for util in \$(/usr/bin/busybox --list); do
    [ ! -f \"/usr/bin/\$util\" ] && /usr/bin/busybox ln -sfv busybox \"/usr/bin/\$util\"
  done
  install -dm1777 /tmp
  xbps-reconfigure -fa
"

DEFAULT_SERVICES="${DEFAULT_SERVICES} busybox-ntpd"
