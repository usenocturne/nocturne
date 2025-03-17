#!/bin/sh
set -e

image_file="$1"

if [ -z "$image_file" ]; then
  echo "USAGE: $0 [IMAGE_PATH]"
  return 1
fi

if [ "-" != "$image_file" ]; then
  # change to directory containing update file
  cd "$(dirname "$image_file")"

  # check integrity of image
  sha256sum -c "$image_file".sha256
fi

# get current mounted partition index
current_idx=$(ab_bootparam root | grep -Eo '[0-9]+$')

# get current uboot partition index
uboot_idx=$(uboot_tool part_current)

ab_active

if [ "$current_idx" -eq 2 ]; then
  echo "Start update for partition B"
  flash_idx=3
else
  echo "Start update for partition A"
  flash_idx=2
fi

fdev="$(ab_bootparam root | grep -o '.*[^0-9]')"
flash_device="${fdev}${flash_idx}"
echo "Flashing: $flash_device"

# flash device
gunzip -c "$image_file" | dd of="$flash_device" status=progress bs=1M iflag=fullblock

# switch active partition if needed
if [ "$current_idx" != "$uboot_idx" ]; then
  echo "U-boot partition already set to inactive partition"
else
  mount -o remount,rw /uboot
  uboot_tool part_switch
  sync
  mount -o remount,ro /uboot
fi
echo "Update complete -> please reboot"
