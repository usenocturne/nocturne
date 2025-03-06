#!/bin/bash

# i hate this but it's needed to make everything fit :(

mkdir -p "$DATAFS_PATH"/libs

mv "$ROOTFS_PATH"/usr/lib/libgallium-24.2.8.so "$DATAFS_PATH"/libs/libgallium-24.2.8.so
ln -s /data/libs/libgallium-24.2.8.so "$ROOTFS_PATH"/usr/lib/libgallium-24.2.8.so

mv "$ROOTFS_PATH"/usr/lib/libLLVM.so.19.1 "$DATAFS_PATH"/libs/libLLVM.so.19.1
ln -s /data/libs/libLLVM.so.19.1 "$ROOTFS_PATH"/usr/lib/libLLVM.so.19.1
