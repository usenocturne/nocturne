#!/usr/bin/env bash

# push S49usbgadget to the device
#   first you need to boot using --boot_adb_kernel

echo "pushing S49usbgadget to device at /etc/init.d/"
adb shell mount -o remount,rw /
adb shell umount /etc/init.d/S49usbgadget 2>/dev/null
adb shell rm /etc/init.d/S49usbgadget
adb push S49usbgadget /etc/init.d/S49usbgadget
adb shell chmod +x /etc/init.d/S49usbgadget
sleep 1s
adb shell mount -o remount,ro /  # OK if this step fails
adb shell reboot

echo "device will reboot in about 5 seconds"
