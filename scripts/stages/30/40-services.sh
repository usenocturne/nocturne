#!/bin/sh

for S in ${DEFAULT_SERVICES}; do
  if [ -d "$ROOTFS_PATH/etc/sv/$S/supervise" ]; then
    rm -rf "$ROOTFS_PATH/etc/sv/$S/supervise"
  fi

  ln -sf /run/runit/supervise."$S" "$ROOTFS_PATH"/etc/sv/"$S"/supervise
  ln -sf /etc/sv/"$S" "$ROOTFS_PATH"/etc/runit/runsvdir/default/
done
