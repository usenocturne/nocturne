#!/bin/sh

(
  mkdir -p "$ROOTFS_PATH"
  cd "$ROOTFS_PATH" || exit 1
  mkdir -p uboot proc sys tmp run dev/pts dev/shm etc/apk
  mkdir -p data "$DATAFS_PATH"/etc "$DATAFS_PATH"/root "$DATAFS_PATH"/etc/network "$DATAFS_PATH"/var/lib
)
