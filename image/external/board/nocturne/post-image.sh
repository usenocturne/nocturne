#!/usr/bin/env bash
set -ex

IMAGES_DIR="$1"

tune2fs -O ^has_journal "$IMAGES_DIR"/rootfs.ext4
e2fsck -f -y "$IMAGES_DIR"/rootfs.ext4 || true
