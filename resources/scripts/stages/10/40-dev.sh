#!/bin/sh

# device manager service for device creation and /dev/stderr etc

colour_echo "setting up eudev"
chroot_exec apk add --no-cache eudev udev-init-scripts
install "$RES_PATH"/scripts/services/ab_root.sh "$ROOTFS_PATH"/etc/init.d/ab_root
SYSINIT_SERVICES="${SYSINIT_SERVICES} udev udev-trigger udev-settle udev-postmount"
