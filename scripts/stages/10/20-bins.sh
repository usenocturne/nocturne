#!/bin/sh

cp "$SCRIPTS_PATH"/reset-data "$ROOTFS_PATH"/sbin/reset-data
cp "$SCRIPTS_PATH"/reset-settings "$ROOTFS_PATH"/sbin/reset-settings

chmod +x "$ROOTFS_PATH"/sbin/reset-data "$ROOTFS_PATH"/sbin/reset-settings

"$HELPERS_PATH"/github_releases.sh -r usenocturne/wingman -a wingman -v "$WINGMAN_TAG" -d "$WORK_PATH"
rm -f wingman wingman.sha256
install "$WORK_PATH"/wingman "$ROOTFS_PATH"/usr/sbin/wingman
