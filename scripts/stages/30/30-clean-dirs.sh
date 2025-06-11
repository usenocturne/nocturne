#!/bin/sh

(
  cd "$ROOTFS_PATH" || exit 1
  rm -rf tmp/*
)

find "$ROOTFS_PATH"/usr/share/locale -mindepth 1 -maxdepth 1 -type d ! -name 'en*' -exec rm -rf {} + 2> /dev/null
rm -rf "$ROOTFS_PATH"/usr/share/locale/en_CA "$ROOTFS_PATH"/usr/share/locale/en_GB
