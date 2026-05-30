#!/bin/sh

echo
color_echo ">> Uncompressed Sizes"
color_echo "used on bootfs: $(du -sh "$BOOTFS_PATH" | sed "s/\s.*//")" -Yellow
color_echo "used on rootfs: $(du -sh "$ROOTFS_PATH" | sed "s/\s.*//")" -Yellow
echo

color_echo ">> Compressed Sizes"
color_echo "size of image: $(du -sh "$OUTPUT_PATH"/nocturne-connector_"$CONNECTOR_IMAGE_VERSION".img.gz | sed "s/\s.*//")" -Yellow
echo

color_echo "$WORK_PATH" -Yellow
echo
