#!/bin/sh

if [ -d "$ROOTFS_PATH"/var/cache/xbps ]; then
  mkdir -p "$CACHE_PATH"
  cp "$ROOTFS_PATH"/var/cache/xbps/* "$CACHE_PATH"/
  rm -rf "$ROOTFS_PATH"/var/cache/xbps/*
fi
