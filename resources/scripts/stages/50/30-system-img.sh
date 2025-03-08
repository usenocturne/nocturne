#!/bin/sh

# swap
fallocate -l 256M ${IMAGE_PATH}/swap.raw
chmod 0600 ${IMAGE_PATH}/swap.raw
mkswap ${IMAGE_PATH}/swap.raw

#cp "$RES_PATH"/flash/misc.raw ${IMAGE_PATH}/

# system
m4 -D xFS=ext4 -D xIMAGE=system.xFS -D xLABEL="system" -D xSIZE="$SIZE_ROOT_FS" -D xUSEMKE2FS \
  "$RES_PATH"/m4/genimage.m4 > "$WORK_PATH"/genimage_root.cfg
make_image ${ROOTFS_PATH} ${WORK_PATH}/genimage_root.cfg

# data 
# TODO: figure out how to make data use the rest, probably start out small and expand on first boot
m4 -D xFS=ext4 -D xIMAGE=data.xFS -D xLABEL="data" -D xSIZE="$SIZE_DATA" -D xUSEMKE2FS \
  "$RES_PATH"/m4/genimage.m4 > "$WORK_PATH"/genimage_data.cfg
make_image ${DATAFS_PATH} ${WORK_PATH}/genimage_data.cfg

###

#m4 "$RES_PATH"/m4/system.m4 > "$WORK_PATH"/genimage_system.cfg
#make_image ${IMAGE_PATH} ${WORK_PATH}/genimage_system.cfg

