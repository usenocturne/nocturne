#!/bin/sh

tar -xavf "$RES_PATH"/flash/Image.tar.zst -C "$BOOTFS_PATH"/

m4 -D xFS=vfat -D xIMAGE=boot.xFS -D xLABEL="BOOT" -D xSIZE="$SIZE_BOOT_FS" \
  "$RES_PATH"/m4/genimage.m4 > "$WORK_PATH"/genimage_boot.cfg
make_image ${BOOTFS_PATH} ${WORK_PATH}/genimage_boot.cfg
