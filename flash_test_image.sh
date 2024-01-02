#!/usr/bin/env bash

# flash data partition from the latest image created by build_image.sh to a connected device
# expects a device already in USB Mode or USB Burn Mode
# also expects a compiled version of superbird_tool in root's PATH

# all config lives in image_config.sh
source ./image_config.sh

CURRENT_IMAGE="${EXISTING_DUMP}/data.ext4"

echo "Going to flash data partition of connected device using $CURRENT_IMAGE"

if [ ! -f "$CURRENT_IMAGE" ]; then
    echo "Could not find: $CURRENT_IMAGE"
    echo "  need to run ./build_image.sh first!"
    exit 1
fi

sudo superbird_tool --restore_partition data "$CURRENT_IMAGE"

