#!/bin/sh

echo
color_echo ">> Uncompressed Sizes"
color_echo "size of root partition: $SIZE_ROOT_FS	| usage: $(du -sh "$ROOTFS_PATH" | sed "s/\s.*//")" -Yellow
echo
