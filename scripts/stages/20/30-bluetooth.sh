#!/bin/sh

#xbps-install -r "$ROOTFS_PATH" -y bluez dbus

mkdir -p "$ROOTFS_PATH"/lib/firmware/brcm
cp "$RES_PATH"/firmware/brcm/* "$ROOTFS_PATH"/lib/firmware/brcm/

cp -a "$SCRIPTS_PATH"/services/bluetooth_adapter "$ROOTFS_PATH"/etc/sv/
cp -a "$SCRIPTS_PATH"/services/superbird_init "$ROOTFS_PATH"/etc/sv/

mkdir -p "$ROOTFS_PATH"/etc/bluetooth
rm -f "$ROOTFS_PATH"/etc/bluetooth/main.conf
cp "$RES_PATH"/config/bluetooth.conf "$ROOTFS_PATH"/etc/bluetooth/main.conf

#DEFAULT_SERVICES="${DEFAULT_SERVICES} dbus bluetooth bluetooth_adapter superbird_init"
