#!/bin/sh -e

# Extract kernel modules from stock image and reuse them on our image.
#
# We assume this script to be called by build.sh, so dir vars (like DEST_ROOT_MOUNT) should
# already be defined for us

msg() {
    echo "[nocturne-copy_modules]" $@ >&2
}

[ -z "$SOURCE_SYSTEM_MOUNT" ] && echo "MOUNTS_DIR undefined" && exit 1
[ -z "$DEST_ROOT_MOUNT" ] && echo "DEST_ROOT_MOUNT undefined" && exit 1
[ -z "$1" ] && echo '$1'" undefined (should be kernel version)" && exit 1

kernel_version="$1"

sudo mkdir -p "$DEST_ROOT_MOUNT/lib/modules/"
sudo cp -r "$SOURCE_SYSTEM_MOUNT/lib/modules/$kernel_version" "$DEST_ROOT_MOUNT/lib/modules/"
