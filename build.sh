#!/bin/sh -e

msg() {
    echo "[*]" $@ >&2
}

msg "Note: this script will use sudo to elevate privileges for mounting images."
read -p "Press enter to continue." _reply

short_usage="Usage: ./build.sh oem-system-part"
if [ "$#" -lt 1 ]; then
    msg "$short_usage"
    exit 1
fi

options_usage="Arguments:
  oem-system-part       Path to system partition from original Car Thing OS
"
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    msg "$short_usage"
    msg "$options_usage"
fi


# usage: format_specific_size [path] [filesystem] [size in bytes]
format_specific_size() {
    path="$1"
    fs="$2"
    size="$3"

    # FIXME: deduplicate the fallocate usage here
    if [ -f "$path" ]; then
        if [ "$(stat --printf="%s" "$path")" -ne "$size" ]; then
            msg "deleting and reallocating $path as it is the wrong size"
            rm "$path"
            fallocate -l "$size" "$path"
        fi
    else
        msg "reallocating $path as it doesn't exist"
        fallocate -l "$size" "$path"
    fi

    case "$fs" in
        ext2)
            msg "formatting $path as ext2"
            mkfs.ext2 -F "$path"
            ;;
    esac
}

# usage: mount_file [name]
mount_file() {
    name="$1"
    msg "Mounting $name"
    sudo mount -o loop "$OUT_DIR/$name" "$MOUNTS_DIR/$name"
}


# used to extract modules from, should be a dump of the OEM OS system partition
SOURCE_SYSTEM="$1"
[ -z "$OUT_DIR" ] && OUT_DIR="./out"
[ -z "$MOUNTS_DIR" ] && MOUNTS_DIR="$OUT_DIR/mounts"
DEST_ROOT="$OUT_DIR/system_a"
DEST_DATA="$OUT_DIR/data"

if [ -d "$MOUNTS_DIR" ]; then
    msg "Unmounting if mounted:" "$MOUNTS_DIR"/*
    sudo umount "$MOUNTS_DIR"/* || :
fi

mkdir -p "$OUT_DIR" "$MOUNTS_DIR"/system

# most dumps have the system partition sizes as 541110272 (516.0429688 MiB)
# let's make it 512 MiB so it's a nice even number, and to have a margin
format_specific_size "$OUT_DIR/system" ext2 536870912
mount_file system

read -p "Done. Unmount everything under $MOUNTS_DIR? [Yn] " yn
case "$yn" in
    [Nn]) exit ;;
    *) sudo umount "$MOUNTS_DIR"/* && msg "Unmounted." ;;
esac
