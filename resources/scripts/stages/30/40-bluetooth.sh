#!/bin/sh

chroot_exec apk add bluez dbus

mkdir -p "$ROOTFS_PATH"/lib/firmware/brcm
cp "$RES_PATH"/firmware/brcm/* "$ROOTFS_PATH"/lib/firmware/brcm/

install ${RES_PATH}/scripts/services/bluetooth_adapter.sh ${ROOTFS_PATH}/etc/init.d/bluetooth_adapter
install ${RES_PATH}/scripts/services/superbird_init.sh ${ROOTFS_PATH}/etc/init.d/superbird_init
chroot_exec rc-update add dbus default
chroot_exec rc-update add bluetooth default
chroot_exec rc-update add bluetooth_adapter default
chroot_exec rc-update add superbird_init sysinit

mkdir -p "$ROOTFS_PATH"/etc/bluetooth
rm -f "$ROOTFS_PATH"/etc/bluetooth/main.conf
cp "$RES_PATH"/config/bluetooth.conf "$ROOTFS_PATH"/etc/bluetooth/main.conf
