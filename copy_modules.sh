#!/bin/sh -e

# Extract kernel modules from stock image and reuse them on our image.
#
# We assume this script to be called by build.sh, so dir vars (like OUT_DIR) should already be
# defined for us

msg() {
    echo "[+]" $@ >&2
}

[ -z "$OUT_DIR" ] && echo "OUT_DIR undefined" && exit 1
[ -z "$MOUNTS_DIR" ] && echo "MOUNTS_DIR undefined" && exit 1
[ -z "$1" ] && echo '$1'" undefined (should be kernel version)" && exit 1

kernel_version="$1"

mkdir -p "$MOUNTS_DIR/source_system"
msg "Mounting $SOURCE_SYSTEM to $MOUNTS_DIR/source_system"
sudo mount -o loop "$SOURCE_SYSTEM" "$MOUNTS_DIR/source_system"

sudo mkdir -p "$MOUNTS_DIR/system/lib/modules/"
sudo cp -pr "$MOUNTS_DIR/source_system/lib/modules/$kernel_version" "$MOUNTS_DIR/system/lib/modules/"
