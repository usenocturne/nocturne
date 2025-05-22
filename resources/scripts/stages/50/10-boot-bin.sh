#!/bin/sh

mkdir -p "$IMAGE_PATH"

tar -xavf "$RES_PATH"/flash/bootfs-blank.bin.tar.zst -C "$WORK_PATH"/
mv "$WORK_PATH"/bootfs-blank.bin "$IMAGE_PATH"/boot.bin

dd if="$RES_PATH"/flash/logo.bin of="$IMAGE_PATH"/boot.bin bs=1M seek=156 conv=notrunc

mkdir -p /mnt/bootbin
losetup -o 4194304 -f "$IMAGE_PATH"/boot.bin
mount -t vfat /dev/loop0 /mnt/bootbin

rm -f /mnt/bootbin/*
cp "$RES_PATH"/flash/fastboot.bin /mnt/bootbin/

github_releases -r usenocturne/u-boot -d /mnt/bootbin/ -a u-boot.bin -v "$NOCTURNE_UBOOT_TAG" -s

mkimage -A arm64 -T script -C none -n "Boot script" -d "$RES_PATH"/flash/boot.cmd /mnt/bootbin/boot.scr

ls -C /mnt/bootbin/
umount /mnt/bootbin
losetup -d /dev/loop0
