#!/bin/sh

curl -L https://dl-cdn.alpinelinux.org/alpine/v"$ALPINE_BUILD"/releases/aarch64/alpine-minirootfs-"$ALPINE_BUILD"."$ALPINE_BUILD_PATCH"-aarch64.tar.gz | tar -xz -C "$ROOTFS_PATH"

"$HELPERS_PATH"/chroot_exec.sh apk update
"$HELPERS_PATH"/chroot_exec.sh apk upgrade --available
"$HELPERS_PATH"/chroot_exec.sh apk add busybox-openrc busybox-extras
