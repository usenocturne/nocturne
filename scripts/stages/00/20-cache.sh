#!/bin/sh

if [ ! -d "$CACHE_PATH" ]; then
  mkdir -p "$ROOTFS_PATH"/var/cache/xbps
  cp "$CACHE_PATH"/* "$ROOTFS_PATH"/var/cache/xbps || true
fi
