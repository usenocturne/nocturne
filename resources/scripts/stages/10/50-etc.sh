#!/bin/sh

# echo local startup files (stored in /etc/local.d/)
echo "rc_verbose=yes" >> ${ROOTFS_PATH}/etc/conf.d/local
# log to kernel printk buffer by default (read with dmesg)
echo "SYSLOGD_OPTS=\"-t -K\"" > ${ROOTFS_PATH}/etc/conf.d/syslog

if [ -n "$LIB_LOG" ]; then
  sed -E "s/.*(rc_logger=).*/\1\"YES\"/" -i ${ROOTFS_PATH}/etc/rc.conf
fi

rm -f "$ROOTFS_PATH"/etc/motd
cp "$RES_PATH"/motd "$ROOTFS_PATH"/etc/motd
