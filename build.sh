#!/bin/sh -e

# sub url must end with slash because it will be concatenated to fname
VOID_BOOTSTRAP_SUBURL="https://repo-default.voidlinux.org/live/current/"
VOID_BOOTSTRAP_FNAME="void-aarch64-ROOTFS-20240314.tar.xz"
VOID_BOOTSTRAP_SHA256="157853d296b02b0d8bb917ae9074d1630834f3803ef14968edc23cf0a7ac8390"

msg() {
    echo "[nocturne]" $@ >&2
}

short_usage="Usage: ./build.sh [--help] oem-system-part path-to-void-repo"
options_usage="Arguments:
  oem-system-part       Path to system partition from original Car Thing OS
  path-to-void-repo     Path to Void binary package repo with Nocturne packages
    For example: if you have https://github.com/usenocturne/void-repo cloned
    at ~/projects/nocturne-void-repo and you are on the main branch, you should put:
      ~/projects/nocturne-void-repo/hostdir/binpkgs/main
    Also, make sure you have built the packages already so they are actually there.

Environment vars:
  PERSISTENT_XBPS_CACHE     Set this variable to make /var/cache/xbps mounted to a persistent location
"
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    msg "$short_usage"
    msg "$options_usage"
    exit 0
fi

if [ "$#" -lt 2 ]; then
    msg "$short_usage"
    exit 1
fi


msg "Note: this script will use sudo to elevate privileges for mounting images."
read -p "Press enter to continue." _reply


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
        ext4)
            msg "formatting $path as ext4"
            mkfs.ext4 -F "$path"
            ;;
        *)
            msg "ERROR: invalid fs type to format, see format_specific_size function"
            ;;
    esac
}


# used to extract modules from, should be a dump of the OEM OS system partition
SOURCE_SYSTEM="$1"
BINPKGS_PATH="$2"
[ -z "$OUT_DIR" ] && OUT_DIR="./out"
[ -z "$MOUNTS_DIR" ] && MOUNTS_DIR="$OUT_DIR/mounts"
DEST_ROOT="$OUT_DIR/data"
DEST_ROOT_MOUNT="$MOUNTS_DIR/data"

if [ -d "$MOUNTS_DIR" ]; then
    msg "Unmounting if mounted:" "$MOUNTS_DIR"/*
    sudo umount -R "$MOUNTS_DIR"/* || :
fi

mkdir -p "$OUT_DIR" "$DEST_ROOT_MOUNT"

# most dumps have the system partition sizes as 541110272 (516.0429688 MiB)
# let's make it 512 MiB so it's a nice even number, and to have a margin
# ignore the above; outdated

# 2 GiB
format_specific_size "$DEST_ROOT" ext4 2147483648
sudo mount -o loop "$DEST_ROOT" "$DEST_ROOT_MOUNT"

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
sudo tar -xvf "$OUT_DIR/$VOID_BOOTSTRAP_FNAME" -C "$DEST_ROOT_MOUNT" > "$OUT_DIR/bootstrap_extract.log"

# we assume the kernel version of stock OS
source_system_mount="$MOUNTS_DIR/source_system"
msg "Mounting $SOURCE_SYSTEM to $source_system_mount"
mkdir -p "$source_system_mount"
sudo mount -o loop "$SOURCE_SYSTEM" "$source_system_mount"
SOURCE_SYSTEM_MOUNT="$source_system_mount" DEST_ROOT_MOUNT="$DEST_ROOT_MOUNT" ./copy_modules.sh 4.9.113

# could be done with `xchroot` tool from void but instead let's do it manually
# in case your distro doesn't have xtools packaged
sudo cp -v /etc/resolv.conf "$DEST_ROOT_MOUNT/etc/"
sudo cp -rv ./files/. "$DEST_ROOT_MOUNT/"

#sudo mount -t proc none "$DEST_ROOT_MOUNT/proc"
#sudo mount -t sysfs none "$DEST_ROOT_MOUNT/sys"
#
## make-rslave: https://unix.stackexchange.com/questions/120827/recursive-umount-after-rbind-mount
#sudo mount --rbind /dev "$DEST_ROOT_MOUNT/dev"
#sudo mount --make-rslave "$DEST_ROOT_MOUNT/dev"
#sudo mount --rbind /run "$DEST_ROOT_MOUNT/run"
#sudo mount --make-rslave "$DEST_ROOT_MOUNT/run"

echo "binpkgs path: $BINPKGS_PATH"

sudo mkdir -p "$DEST_ROOT_MOUNT/nocturne-repo"
sudo mount --bind "$BINPKGS_PATH" "$DEST_ROOT_MOUNT/nocturne-repo"


# do not uncomment or else you might have issues with them staying mounted in other mnt ns'es for some reason
if ! [ -z "$PERSISTENT_XBPS_CACHE" ]; then
    mkdir -p ./cache/xbps
    sudo mkdir -p "$DEST_ROOT_MOUNT/var/cache/xbps"
    sudo mount --bind ./cache/xbps "$DEST_ROOT_MOUNT/var/cache/xbps"
fi

# bwrap is not an option because we need root inside the chroot here
sudo chroot "$DEST_ROOT_MOUNT" /bin/bash -x <<EOF
    xbps-install -Suy
    xbps-install -y nocturne-base
EOF

echo
echo
echo
msg "Nocturne image is finished building. Partition images available under $OUT_DIR."
read -p "Unmount everything under $MOUNTS_DIR? [Yn] " yn
case "$yn" in
    [Nn]) exit ;;
    *) sudo umount -R "$MOUNTS_DIR"/* && msg "Unmounted." ;;
esac
