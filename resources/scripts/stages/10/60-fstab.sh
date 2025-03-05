#!/bin/sh

if [ -f "${INPUT_PATH}/m4/fstab.m4" ]; then
  colour_echo "   adding user fstab"
  M4ARG="$M4ARG -D xFSTAB=${INPUT_PATH}/m4/fstab.m4"
fi
if [ -n "$LIB_LOG" ]; then
  M4ARG="$M4ARG -D xLIBLOG=${LIB_LOG}"
fi
colour_echo "   calling m4 with $M4ARG"
# install fstab
m4 ${M4ARG} "$RES_PATH"/m4/fstab.m4 > ${ROOTFS_PATH}/etc/fstab

cat ${ROOTFS_PATH}/etc/fstab
