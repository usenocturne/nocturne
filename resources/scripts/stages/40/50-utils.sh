#!/bin/sh

install ${RES_PATH}/scripts/ab_bootparam.sh ${ROOTFS_PATH}/usr/sbin/ab_bootparam

github_releases -r usenocturne/wingman -a wingman
install ./wingman ${ROOTFS_PATH}/usr/sbin/wingman
