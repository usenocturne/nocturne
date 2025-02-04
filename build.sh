#!/bin/sh -e

# sub url must end with slash because it will be concatenated to fname
VOID_BOOTSTRAP_SUBURL="https://repo-default.voidlinux.org/live/current/"
VOID_BOOTSTRAP_FNAME="void-aarch64-ROOTFS-20240314.tar.xz"
VOID_BOOTSTRAP_SHA256="157853d296b02b0d8bb917ae9074d1630834f3803ef14968edc23cf0a7ac8390"

msg() {
    echo "[nocturne]" $@ >&2
}

if ! command -v mksquashfs > /dev/null; then
    msg "Please install mksquashfs"
    exit 1
fi

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
        squashfs)
            msg "formatting $path as squashfs"
            mksquashfs -comp zstd "$path"
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
[ -z "$TREES_DIR" ] && TREES_DIR="$OUT_DIR/trees"
#DEST_ROOT="$OUT_DIR/data"
DEST_ROOT_MOUNT="$TREES_DIR/system_root"
source_system_mount="$MOUNTS_DIR/source_system"

umount_all() {
    xbps_mount="$DEST_ROOT_MOUNT/var/cache/xbps"
    nocturne_repo_mount="$DEST_ROOT_MOUNT/nocturne-repo"
    msg "Unmounting if mounted: $source_system_mount $xbps_mount $nocturne_repo_mount"
    sudo umount -R "$source_system_mount" "$xbps_mount" "$nocturne_repo_mount"
}

if [ -d "$OUT_DIR" ]; then
    umount_all || :
fi

msg "Cleaning up files"
read -p "Type y and press enter to \`rm -rf $DEST_ROOT_MOUNT\`: " yn
case "$yn" in
    y) sudo rm -rf "$DEST_ROOT_MOUNT" ;;
    *)
        msg "Will not delete $DEST_ROOT_MOUNT. Exiting."
        exit 1
        ;;
esac

mkdir -p "$OUT_DIR" "$DEST_ROOT_MOUNT"

# most dumps have the system partition sizes as 541110272 (516.0429688 MiB)
# let's make it 512 MiB so it's a nice even number, and to have a margin
# ignore the above; outdated

# 2 GiB
#format_specific_size "$DEST_ROOT" squashfs 2147483648
#sudo mount -o loop "$DEST_ROOT" "$DEST_ROOT_MOUNT"

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

sudo mkdir -p "$DEST_ROOT_MOUNT/nocturne-repo"
sudo mount --bind "$BINPKGS_PATH" "$DEST_ROOT_MOUNT/nocturne-repo"


# do not uncomment or else you might have issues with them staying mounted in other mnt ns'es for some reason
if ! [ -z "$PERSISTENT_XBPS_CACHE" ]; then
    mkdir -p ./cache/xbps
    sudo mkdir -p "$DEST_ROOT_MOUNT/var/cache/xbps"
    sudo mount --bind ./cache/xbps "$DEST_ROOT_MOUNT/var/cache/xbps"
fi

# bwrap is not an option because we need root inside the chroot here
sudo chroot "$DEST_ROOT_MOUNT" /bin/bash -ex <<EOF
    xbps-install -Suy
    xbps-install -y \
        base-files coreutils findutils diffutils dash bash grep gzip sed gawk \
        util-linux which tar shadow procps-ng iana-etc xbps tzdata \
        removed-packages \
        sudo file less man-pages e2fsprogs dhcpcd nvi vim nano \
        runit-void
    xbps-install -y cage
    xbps-install -y nocturne-ui nocturned

    ln -s /etc/sv/nocturne-ui-prodserver /etc/runit/runsvdir/default/
    ln -s /etc/sv/nocturne-ui /etc/runit/runsvdir/default/
    ln -s /etc/sv/nocturned /etc/runit/runsvdir/default/

    mkdir /etc/sv/cage-nocturne
    cat <<EOS > /etc/sv/cage-nocturne/run
#!/bin/sh
exec 2>&1
exec cage -D -- chromium https://localhost:3500
EOS

    ln -s /etc/sv/cage-nocturne /etc/runit/runsvdir/default/
EOF

rm "$OUT_DIR/system"
sudo mksquashfs "$DEST_ROOT_MOUNT" "$OUT_DIR/system" -comp zstd
sudo chown "$(id -u):$(id -g)" "$DEST_ROOT_MOUNT"

echo
echo
echo
msg "Nocturne image is finished building. Partition images available under $OUT_DIR."
read -p "Unmount everything under $OUT_DIR? [Yn] " yn
case "$yn" in
    [Nn]) exit ;;
    *) umount_all && msg "Unmounted." ;;
esac
