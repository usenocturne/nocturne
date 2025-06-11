#!/bin/sh

rsync -aAXv "$RES_PATH"/stock-files/output/ "$ROOTFS_PATH"/

# execstack -c "$ROOTFS_PATH"/usr/lib/libMali.so
