#!/bin/sh

github_releases -r usenocturne/uboot-tool -a uboot_tool -v "$NOCTURNE_UBOOT_TOOL_TAG"
#gitlab_packages -p 33098050 -a uboot-tool
install ./uboot_tool "$ROOTFS_PATH"/usr/sbin/uboot_tool

install "$RES_PATH"/scripts/ab_active.sh "$ROOTFS_PATH"/usr/sbin/ab_active
install "$RES_PATH"/scripts/ab_bootparam.sh "$ROOTFS_PATH"/usr/sbin/ab_bootparam
install "$RES_PATH"/scripts/ab_flash.sh "$ROOTFS_PATH"/usr/sbin/ab_flash
