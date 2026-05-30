#!/bin/sh

for S in ${SYSINIT_SERVICES}; do
  "$HELPERS_PATH"/chroot_exec.sh rc-update add "$S" sysinit
done

for S in ${BOOT_SERVICES}; do
  "$HELPERS_PATH"/chroot_exec.sh rc-update add "$S" boot
done

for S in ${DEFAULT_SERVICES}; do
  "$HELPERS_PATH"/chroot_exec.sh rc-update add "$S" default
done

for S in ${SHUTDOWN_SERVICES}; do
  "$HELPERS_PATH"/chroot_exec.sh rc-update add "$S" shutdown
done
