#!/bin/sh

(
  cd "$ROOTFS_PATH" || exit 1
  rm -rf tmp/*
  rm -rf var/cache/apk/* usr/lib/gallium-pipe/*
  cp -a var/lib "$DATAFS_PATH"/var/
)
