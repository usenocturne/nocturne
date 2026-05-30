#!/bin/sh

# boot
cp "$RES_PATH"/config/cmdline.txt "$RES_PATH"/config/config.txt "$BOOTFS_PATH"/
rsync -a "$WORK_PATH"/kernel/boot/ "$BOOTFS_PATH"/

m4 -D xFS=vfat -D xIMAGE=boot.xFS -D xLABEL="BOOT" -D xSIZE="$SIZE_BOOT" \
  -D xEXTRAARGS="-F 32 -h 8192" \
  "$RES_PATH"/m4/genimage.m4 > "$WORK_PATH"/genimage_boot.cfg
make_image "$BOOTFS_PATH" "$WORK_PATH"/genimage_boot.cfg

# root
mkdir -p "$ROOTFS_PATH"/lib/modules
cp -r "$WORK_PATH"/kernel/lib/modules/* "$ROOTFS_PATH"/lib/modules/

m4 -D xFS=ext4 -D xIMAGE=rootfs.xFS -D xLABEL="rootfs" -D xSIZE="$SIZE_ROOT" -D xUSEMKE2FS \
  "$RES_PATH"/m4/genimage.m4 > "$WORK_PATH"/genimage_root.cfg
make_image "$ROOTFS_PATH" "$WORK_PATH"/genimage_root.cfg
