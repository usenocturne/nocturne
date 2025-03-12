#!/bin/sh

# echo local startup files (stored in /etc/local.d/)
echo "rc_verbose=yes" >> "$ROOTFS_PATH"/etc/conf.d/local
# log to kernel printk buffer by default (read with dmesg)
echo "SYSLOGD_OPTS=\"-t -K\"" > "$ROOTFS_PATH"/etc/conf.d/syslog

rm -f "$ROOTFS_PATH"/etc/motd "$ROOTFS_PATH"/etc/fstab
cp "$RES_PATH"/config/motd "$ROOTFS_PATH"/etc/motd
cp "$RES_PATH"/config/fstab "$ROOTFS_PATH"/etc/fstab

ln -fs /data/etc/timezone "$ROOTFS_PATH"/etc/timezone
ln -fs /data/etc/localtime "$ROOTFS_PATH"/etc/localtime

ln -fs /data/etc/hostname "$ROOTFS_PATH"/etc/hostname
ln -fs /data/etc/network/interfaces "$ROOTFS_PATH"/etc/network/interfaces
