#!/bin/sh

(
  cd ${ROOTFS_PATH} || exit 1
  rm -rf tmp/*
  rm -rf var/cache/apk/* usr/lib/gallium-pipe/*
  if [ -n "${LIB_LOG}" ]; then
    cp -a var/lib var/log ${DATAFS_PATH}/var/
  fi
)
