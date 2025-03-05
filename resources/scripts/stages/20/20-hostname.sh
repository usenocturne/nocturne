#!/bin/sh

# set host name
echo "${DEFAULT_HOSTNAME}" > ${ROOTFS_PATH}/etc/hostname.alpine-builder
cp ${ROOTFS_PATH}/etc/hostname.alpine-builder ${DATAFS_PATH}/etc/hostname