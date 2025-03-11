#!/bin/sh

chroot_exec apk add weston weston-backend-drm seatd weston-shell-desktop chromium

chroot_exec rc-update add seatd default
chroot_exec rc-update add swap boot

echo "KERNEL==\"event0\", SUBSYSTEM==\"input\", GROUP=\"input\", MODE=\"0660\", ENV{ID_INPUT_KEYBOARD}=\"1\", ENV{LIBINPUT_DEVICE_GROUP}=\"gpio-keys\"" > "$ROOTFS_PATH"/usr/lib/udev/rules.d/97-keys.rules
echo "KERNEL==\"event1\", SUBSYSTEM==\"input\", GROUP=\"input\", MODE=\"0660\", ENV{ID_INPUT_KEYBOARD}=\"1\", ENV{LIBINPUT_DEVICE_GROUP}=\"rotary-input\"" > "$ROOTFS_PATH"/usr/lib/udev/rules.d/97-rotary.rules
echo "KERNEL==\"event2\", SUBSYSTEM==\"input\", ENV{LIBINPUT_CALIBRATION_MATRIX}=\"0 1 0 -1 0 1\" ENV{WL_OUTPUT}=\"DSI-1\"" > "$ROOTFS_PATH"/usr/lib/udev/rules.d/97-touchscreen.rules

mkdir -p "$ROOTFS_PATH"/etc/weston
rm -f "$ROOTFS_PATH"/etc/weston/weston.ini
cp "$RES_PATH"/config/weston.ini "$RES_PATH"/background.png "$ROOTFS_PATH"/etc/weston/

mkdir -p "$DATAFS_PATH"/etc/chrome/cache "$DATAFS_PATH"/etc/chrome/data
mkdir -pm 0700 "$DATAFS_PATH"/tmp/0-runtime-dir

install ${RES_PATH}/scripts/services/weston.sh ${ROOTFS_PATH}/etc/init.d/weston
chroot_exec rc-update add weston default
