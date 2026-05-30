#!/bin/sh

DISK_SIGNATURE="0x$(head -c 4 /dev/urandom | od -An -tx4 | tr -d ' \n')"
if [ "$DISK_SIGNATURE" = "0x00000000" ]; then
  DISK_SIGNATURE="0x12345678"
fi

m4 -D xSIZE_ROOT="$SIZE_ROOT" \
  -D xDISK_SIGNATURE="$DISK_SIGNATURE" \
  "$RES_PATH"/m4/sdcard.m4 > "$WORK_PATH"/genimage_sdcard.cfg
make_image "$IMAGE_PATH" "$WORK_PATH"/genimage_sdcard.cfg
