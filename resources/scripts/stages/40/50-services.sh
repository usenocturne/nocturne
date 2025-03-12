#!/bin/sh

for S in ${SYSINIT_SERVICES}; do
  chroot_exec rc-update add "$S" sysinit
done

for S in ${DEFAULT_SERVICES}; do
  chroot_exec rc-update add "$S" default
done

for S in ${BOOT_SERVICES}; do
  chroot_exec rc-update add "$S" boot
done
