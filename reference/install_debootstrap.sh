#!/usr/bin/env bash

# install debootstrap on the regular system partition, via adb


command -v adb || {
    echo "Error: missing adb, on Debian Linux try: apt-get install android-sdk-platform-tools"
    exit 1
}

set -e  # bail on any errors

echo "set device root filesystem to read/write"
adb shell mount -o remount,rw /

echo "installing debootstrap"
adb push debootstrap-superbird.tar.gz /var/
adb shell tar xf /var/debootstrap-superbird.tar.gz -C /
adb shell rm /var/debootstrap-superbird.tar.gz

echo "set device root filesystem back to read-only"
adb shell mount -o remount,ro /

echo "debootstrap installation complete"
