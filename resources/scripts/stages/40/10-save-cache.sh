#!/bin/sh

# save cache
if [ -d "$ROOTFS_PATH"/etc/apk/cache ]; then
  mkdir -p "$CACHE_PATH"/apk/
  cp "$ROOTFS_PATH"/etc/apk/cache/*.apk "$CACHE_PATH"/apk
  cp "$ROOTFS_PATH"/etc/apk/cache/*.gz "$CACHE_PATH"/apk
  rm -rf "$ROOTFS_PATH"/etc/apk/cache
fi
