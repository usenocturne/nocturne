#!/bin/sh

github_releases -r usenocturne/uboot-tool -a uboot_tool
#gitlab_packages -p 33098050 -a uboot-tool
install ./uboot_tool "$ROOTFS_PATH"/usr/sbin/uboot_tool

install "$RES_PATH"/scripts/services/uboot_reset.sh "$ROOTFS_PATH"/etc/local.d/99-uboot.start

install "$RES_PATH"/scripts/ab_bootparam.sh "$ROOTFS_PATH"/usr/sbin/ab_bootparam
install "$RES_PATH"/scripts/ab_flash.sh "$ROOTFS_PATH"/usr/sbin/ab_flash
