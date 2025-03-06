#!/bin/sh

install ${RES_PATH}/scripts/services/data_prepare.sh ${ROOTFS_PATH}/etc/init.d/data_prepare
DEFAULT_SERVICES="${DEFAULT_SERVICES} data_prepare"
