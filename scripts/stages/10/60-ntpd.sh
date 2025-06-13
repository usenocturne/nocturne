#!/bin/sh

xbps-install -r "$ROOTFS_PATH" -y openntpd

DEFAULT_SERVICES="${DEFAULT_SERVICES} openntpd"
