#!/bin/sh

# device manager service for device creation and /dev/stderr etc
# setup-udev removed in 3.17

case ${DEV} in
  eudev)
    chroot_exec apk add eudev
    if [ -f ${ROOTFS_PATH}/sbin/setup-udev ]; then
      colour_echo "setting up eudev with setup-udev"
      chroot_exec setup-udev -n
    else
      colour_echo "setting up eudev"
      chroot_exec apk add udev-init-scripts udev-init-scripts-openrc
      SYSINIT_SERVICES="${SYSINIT_SERVICES} udev udev-trigger udev-settle udev-postmount"
    fi
    install ${RES_PATH}/scripts/ab_root.sh ${ROOTFS_PATH}/etc/init.d/ab_root
    SYSINIT_SERVICES="${SYSINIT_SERVICES} ab_root"
    if [ "$DEFAULT_KERNEL_MODULES" != "*" ]; then
      DEFAULT_KERNEL_MODULES="$DEFAULT_KERNEL_MODULES uio bcm2835-mmal-vchiq brcmutil cfg80211 videobuf2-vmalloc videobuf2-dma-contig v4l2-mem2mem"
    fi
    ;;
  *)
    SYSINIT_SERVICES="${SYSINIT_SERVICES} mdev"
    ;;
esac
