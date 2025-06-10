#!/bin/sh

(
  mkdir -p "$ROOTFS_PATH"
  cd "$ROOTFS_PATH" || exit 1
  mkdir -p proc sys tmp run dev/pts dev/shm
)
