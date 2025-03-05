#!/bin/sh

# add ab_clock as Car Thing does not have a hardware clock
install ${RES_PATH}/scripts/ab_clock.sh ${ROOTFS_PATH}/etc/init.d/ab_clock
DEFAULT_SERVICES="${DEFAULT_SERVICES} ab_clock"
echo "clock_file=\"${SETUP_PREFIX}/etc/ab_clock_saved_time\"" > ${ROOTFS_PATH}/etc/conf.d/ab_clock

# save initial time for ab_clock
touch ${DATAFS_PATH}/etc/ab_clock_saved_time
