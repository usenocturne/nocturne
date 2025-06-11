#!/bin/sh

for S in ${DEFAULT_SERVICES}; do
  echo "/etc/sv/$S -> /etc/runit/runsvdir/default/"
  ln -s /etc/sv/"$S" "$ROOTFS_PATH"/etc/runit/runsvdir/default/
done
