#!/bin/sh

xbps-install -r "$ROOTFS_PATH" -y seatd libinput nss

echo "KERNEL==\"event0\", SUBSYSTEM==\"input\", GROUP=\"input\", MODE=\"0660\", ENV{ID_INPUT_KEYBOARD}=\"1\", ENV{LIBINPUT_DEVICE_GROUP}=\"gpio-keys\"" > "$ROOTFS_PATH"/usr/lib/udev/rules.d/97-keys.rules
echo "KERNEL==\"event1\", SUBSYSTEM==\"input\", GROUP=\"input\", MODE=\"0660\", ENV{ID_INPUT_KEYBOARD}=\"1\", ENV{LIBINPUT_DEVICE_GROUP}=\"rotary-input\"" > "$ROOTFS_PATH"/usr/lib/udev/rules.d/97-rotary.rules
echo "KERNEL==\"event2\", SUBSYSTEM==\"input\", ENV{LIBINPUT_CALIBRATION_MATRIX}=\"0 1 0 -1 0 1\" ENV{WL_OUTPUT}=\"DSI-1\"" > "$ROOTFS_PATH"/usr/lib/udev/rules.d/97-touchscreen.rules

mkdir -p "$ROOTFS_PATH"/etc/weston
rm -f "$ROOTFS_PATH"/etc/weston/weston.ini
cp "$RES_PATH"/config/weston.ini "$RES_PATH"/config/background.png "$ROOTFS_PATH"/etc/weston/

echo "/lib/modules/4.9.113/hardware/aml-4.9/arm/gpu/mali.ko" > "$ROOTFS_PATH"/etc/modules-load.d/mali.conf

cp -a "$SCRIPTS_PATH"/services/weston "$ROOTFS_PATH"/etc/sv/
cp -a "$SCRIPTS_PATH"/services/chromium "$ROOTFS_PATH"/etc/sv/

DEFAULT_SERVICES="${DEFAULT_SERVICES} seatd weston chromium"
