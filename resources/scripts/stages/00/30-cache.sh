#!/bin/sh

if [ -n "$CACHE_PATH" ]; then
  mkdir -p "$ROOTFS_PATH"/etc/apk/cache
  if [ -d "$CACHE_PATH"/apk ]; then
    cp "$CACHE_PATH"/apk/*.apk "$ROOTFS_PATH"/etc/apk/cache
    cp "$CACHE_PATH"/apk/*.gz "$ROOTFS_PATH"/etc/apk/cache
  fi
fi
