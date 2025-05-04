#!/bin/sh

chroot_exec apk add bluez dbus bluez-alsa alsa-utils

mkdir -p "$ROOTFS_PATH"/lib/firmware/brcm
cp "$RES_PATH"/firmware/brcm/* "$ROOTFS_PATH"/lib/firmware/brcm/

install "$RES_PATH"/scripts/services/bluetooth_adapter.sh "$ROOTFS_PATH"/etc/init.d/bluetooth_adapter
install "$RES_PATH"/scripts/services/superbird_init.sh "$ROOTFS_PATH"/etc/init.d/superbird_init

mkdir -p "$ROOTFS_PATH"/etc/bluetooth
rm -f "$ROOTFS_PATH"/etc/bluetooth/main.conf
cp "$RES_PATH"/config/bluetooth.conf "$ROOTFS_PATH"/etc/bluetooth/main.conf

DEFAULT_SERVICES="${DEFAULT_SERVICES} dbus bluetooth bluetooth_adapter bluealsa alsa"
SYSINIT_SERVICES="${SYSINIT_SERVICES} superbird_init"
