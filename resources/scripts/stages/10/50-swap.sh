#!/bin/sh

fallocate -l 256M "$DATAFS_PATH"/swapfile
mkswap "$DATAFS_PATH"/swapfile
chmod 600 "$DATAFS_PATH"/swapfile
