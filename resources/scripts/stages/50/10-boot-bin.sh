#!/bin/sh

mkdir -p "$IMAGE_PATH"

tar -xavf "$RES_PATH"/flash/bootfs-blank.bin.tar.zst -C "$WORK_PATH"/
mv "$WORK_PATH"/bootfs-blank.bin "$IMAGE_PATH"/boot.bin

dd if="$RES_PATH"/flash/logo.bin of="$IMAGE_PATH"/boot.bin bs=1M seek=156 conv=notrunc

mkdir -p /mnt/bootbin
losetup -o 4194304 /dev/loop0 "$IMAGE_PATH"/boot.bin
mount -t vfat /dev/loop0 /mnt/bootbin

cp "$RES_PATH"/kernel/output/Image "$RES_PATH"/kernel/output/dtbs/superbird.dtb /mnt/bootbin/
ls -C /mnt/bootbin/

umount /mnt/bootbin
losetup -d /dev/loop0
