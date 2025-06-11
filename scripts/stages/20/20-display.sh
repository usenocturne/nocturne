#!/bin/sh

#xbps-install -r "$ROOTFS_PATH" -y seatd fontconfig libinput

echo "KERNEL==\"event0\", SUBSYSTEM==\"input\", GROUP=\"input\", MODE=\"0660\", ENV{ID_INPUT_KEYBOARD}=\"1\", ENV{LIBINPUT_DEVICE_GROUP}=\"gpio-keys\"" > "$ROOTFS_PATH"/usr/lib/udev/rules.d/97-keys.rules
echo "KERNEL==\"event1\", SUBSYSTEM==\"input\", GROUP=\"input\", MODE=\"0660\", ENV{ID_INPUT_KEYBOARD}=\"1\", ENV{LIBINPUT_DEVICE_GROUP}=\"rotary-input\"" > "$ROOTFS_PATH"/usr/lib/udev/rules.d/97-rotary.rules
echo "KERNEL==\"event2\", SUBSYSTEM==\"input\", ENV{LIBINPUT_CALIBRATION_MATRIX}=\"0 1 0 -1 0 1\" ENV{WL_OUTPUT}=\"DSI-1\"" > "$ROOTFS_PATH"/usr/lib/udev/rules.d/97-touchscreen.rules

mkdir -p "$ROOTFS_PATH"/etc/weston
rm -f "$ROOTFS_PATH"/etc/weston/weston.ini
cp "$RES_PATH"/config/weston.ini "$RES_PATH"/config/background.png "$ROOTFS_PATH"/etc/weston/

cp -a "$SCRIPTS_PATH"/services/weston "$ROOTFS_PATH"/etc/sv/

#DEFAULT_SERVICES="${DEFAULT_SERVICES} seatd"
