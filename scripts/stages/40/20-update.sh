#!/bin/sh

mkdir -p "$UPDATE_PATH"/etc/nocturne "$UPDATE_PATH"/usr/sbin
cp -R "$ROOTFS_PATH"/etc/nocturne/* "$UPDATE_PATH"/etc/nocturne/

cp "$ROOTFS_PATH"/usr/sbin/nocturned "$UPDATE_PATH"/usr/sbin/
cp "$ROOTFS_PATH"/usr/sbin/wingman "$UPDATE_PATH"/usr/sbin/

chown -R 0:0 "$UPDATE_PATH"/*
tar -cf - -C "$UPDATE_PATH"/ . | zstd -9 -o "$IMAGE_PATH"/nocturne_update.tar.zst
