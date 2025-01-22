#!/bin/sh -e

# sub url must end with slash because it will be concatenated to fname
VOID_BOOTSTRAP_SUBURL="https://repo-default.voidlinux.org/live/current/"
VOID_BOOTSTRAP_FNAME="void-aarch64-ROOTFS-20240314.tar.xz"
VOID_BOOTSTRAP_SHA256="157853d296b02b0d8bb917ae9074d1630834f3803ef14968edc23cf0a7ac8390"

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

void_checksum() {
    echo "$VOID_BOOTSTRAP_SHA256 $OUT_DIR/$VOID_BOOTSTRAP_FNAME" | sha256sum -c
}

if void_checksum; then
    msg "Skipping download of Void bootstrap as the hash matches."
else
    msg "Downloading Void bootstrap: $VOID_BOOTSTRAP_SUBURL$VOID_BOOTSTRAP_FNAME"
    curl -Lo "$OUT_DIR/$VOID_BOOTSTRAP_FNAME" "$VOID_BOOTSTRAP_SUBURL$VOID_BOOTSTRAP_FNAME"
    msg "Checking hash of bootstrap"
    void_checksum || { msg "Checksum failed!"; exit 1; }
fi

msg "Extracting $OUT_DIR/$VOID_BOOTSTRAP_FNAME"
sudo tar -xvf "$OUT_DIR/$VOID_BOOTSTRAP_FNAME" -C "$MOUNTS_DIR/system" > "$OUT_DIR/bootstrap_extract.log"

# we assume the kernel version of stock OS
OUT_DIR="$OUT_DIR" MOUNTS_DIR="$MOUNTS_DIR" SOURCE_SYSTEM="$SOURCE_SYSTEM" ./copy_modules.sh 4.9.113


read -p "Done. Unmount everything under $MOUNTS_DIR? [Yn] " yn
case "$yn" in
    [Nn]) exit ;;
    *) sudo umount "$MOUNTS_DIR"/* && msg "Unmounted." ;;
esac
