#!/bin/sh

# data partition
m4 -D xFS=ext4 -D xIMAGE=data.xFS -D xLABEL="data" -D xSIZE="$SIZE_DATA" -D xUSEMKE2FS \
  "$RES_PATH"/m4/genimage.m4 > "$WORK_PATH"/genimage_data.cfg
make_image ${DATAFS_PATH} ${WORK_PATH}/genimage_data.cfg
