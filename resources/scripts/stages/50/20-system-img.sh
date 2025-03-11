#!/bin/sh

fallocate -l 256M "$IMAGE_PATH"/swap.bin
mkswap "$IMAGE_PATH"/swap.bin

# system
m4 -D xFS=ext4 -D xIMAGE=system.xFS -D xLABEL="system" -D xSIZE="$SIZE_ROOT_FS" -D xUSEMKE2FS \
  "$RES_PATH"/m4/genimage.m4 > "$WORK_PATH"/genimage_root.cfg
make_image "$ROOTFS_PATH" "$WORK_PATH"/genimage_root.cfg

# data
m4 -D xFS=ext4 -D xIMAGE=data.xFS -D xLABEL="data" -D xSIZE="$SIZE_DATA" -D xUSEMKE2FS \
  "$RES_PATH"/m4/genimage.m4 > "$WORK_PATH"/genimage_data.cfg
make_image "$DATAFS_PATH" "$WORK_PATH"/genimage_data.cfg
