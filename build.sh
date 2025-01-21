#!/bin/sh -e

short_usage="Usage: ./build.sh oem-system-part"
if [ "$#" -lt 1 ]; then
    echo "$short_usage"
    exit 1
fi

options_usage="Arguments:
  oem-system-part       Path to system partition from original Car Thing OS
"
if [ "$1" = "--help" || "$1" = "-h" ]; then
    echo "$short_usage"
    echo "$options_usage"
fi

# used to extract modules from, should be a dump of the OEM OS system partition
SOURCE_SYSTEM="$1"
DEST_ROOT="./out/system_a.ext2"
DEST_DATA="./out/data.ext4"
