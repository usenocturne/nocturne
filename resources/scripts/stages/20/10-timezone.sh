#!/bin/sh

# set timezone
echo "${DEFAULT_TIMEZONE}" > ${ROOTFS_PATH}/etc/timezone.alpine-builder
cp ${ROOTFS_PATH}/etc/timezone.alpine-builder ${DATAFS_PATH}/etc/timezone
ln -fs /usr/share/zoneinfo/${DEFAULT_TIMEZONE} ${DATAFS_PATH}/etc/localtime
