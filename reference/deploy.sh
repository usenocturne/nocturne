#!/usr/bin/env bash

# deploy files to device for 
#   USB Gadget
#   creating root on data partition

# only works on Linux
if [ "$(uname -s)" != "Linux" ]; then
    echo "This script is only compatible with Linux"
    echo "  This system is: $(uname -s) $(uname -m)"
    exit 1
fi

command -v adb || {
    echo "Error: missing adb, try: apt-get install android-sdk-platform-tools"
    exit 1
}

set -e  # bail on any errors

# set device root filesystem to read/write mode
adb shell mount -o remount,rw /

# deploy updated scripts
echo "Updating scripts on device"

adb shell "mkdir -p /scripts"
adb shell "rm /scripts/*"

adb push install_debian.sh /scripts/


NOWDATE=$(date "+%Y-%m-%d %H:%M:%S")
adb shell date -s "\"$NOWDATE\""

# set device root filesystem back to read-only
adb shell mount -o remount,ro /

echo "Deploy complete"
