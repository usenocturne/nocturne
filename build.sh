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
BINPKGS_PATH="$2"
[ -z "$OUT_DIR" ] && OUT_DIR="./out"
[ -z "$MOUNTS_DIR" ] && MOUNTS_DIR="$OUT_DIR/mounts"
DEST_ROOT="$OUT_DIR/system_a"
DEST_DATA="$OUT_DIR/data"

if [ -d "$MOUNTS_DIR" ]; then
    msg "Unmounting if mounted:" "$MOUNTS_DIR"/*
    sudo umount -R "$MOUNTS_DIR"/* || :
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
read -p "press enter to extract" ksjadf
sudo tar -xvf "$OUT_DIR/$VOID_BOOTSTRAP_FNAME" -C "$MOUNTS_DIR/system" > "$OUT_DIR/bootstrap_extract.log"

# we assume the kernel version of stock OS
OUT_DIR="$OUT_DIR" MOUNTS_DIR="$MOUNTS_DIR" SOURCE_SYSTEM="$SOURCE_SYSTEM" ./copy_modules.sh 4.9.113

# could be done with `xchroot` tool from void but instead let's do it manually
# in case your distro doesn't have xtools packaged
system_mountpoint="$MOUNTS_DIR/system"
sudo cp -v /etc/resolv.conf "$system_mountpoint/etc/"
sudo cp -rv ./files/. "$system_mountpoint/"

#sudo mount -t proc none "$system_mountpoint/proc"
#sudo mount -t sysfs none "$system_mountpoint/sys"
#
## make-rslave: https://unix.stackexchange.com/questions/120827/recursive-umount-after-rbind-mount
#sudo mount --rbind /dev "$system_mountpoint/dev"
#sudo mount --make-rslave "$system_mountpoint/dev"
#sudo mount --rbind /run "$system_mountpoint/run"
#sudo mount --make-rslave "$system_mountpoint/run"

echo "binpkgs path: $BINPKGS_PATH"
read -p "before mount nocturne-repo" skdaf

sudo mkdir -p "$system_mountpoint/nocturne-repo"
sudo mount --bind "$BINPKGS_PATH" "$system_mountpoint/nocturne-repo"


read -p "done mount " dsfakj

# do not uncomment or else you might have issues with them staying mounted in other mnt ns'es for some reason
if ! [ -z "$PERSISTENT_XBPS_CACHE" ]; then
    read -p "enter persistent" asdfkj
    mkdir -p ./cache/xbps
    sudo mkdir -p "$system_mountpoint/var/cache/xbps"
    sudo mount --bind ./cache/xbps "$system_mountpoint/var/cache/xbps"
    read -p "done mount persistent" asjdkf
fi

# bwrap is not an option because we need root inside the chroot here
sudo chroot "$system_mountpoint" /bin/bash <<EOF
    xbps-install -Suy
    xbps-install -y nocturne-base
EOF

read -p "Done. Unmount everything under $MOUNTS_DIR? [Yn] " yn
case "$yn" in
    [Nn]) exit ;;
    *) sudo umount -R "$MOUNTS_DIR"/* && msg "Unmounted." ;;
esac
