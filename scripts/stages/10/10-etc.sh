#!/bin/sh

xbps-install -r "$ROOTFS_PATH" -y openssh

rm -f "$ROOTFS_PATH"/etc/motd "$ROOTFS_PATH"/etc/fstab
cp "$RES_PATH"/config/motd "$ROOTFS_PATH"/etc/motd
cp "$RES_PATH"/config/fstab "$ROOTFS_PATH"/etc/fstab

ln -sf /var/local/etc/localtime "$ROOTFS_PATH"/etc/localtime

echo "$DEFAULT_HOSTNAME" > "$ROOTFS_PATH"/etc/hostname

root_pw=$(mkpasswd -m sha-512 -s "$DEFAULT_ROOT_PASSWORD")
sed -i "/^root/d" "$ROOTFS_PATH"/etc/shadow
echo "root:${root_pw}:19000:0:99999::::" >> "$ROOTFS_PATH"/etc/shadow
"$HELPERS_PATH"/chroot_exec.sh chsh -s /bin/bash root

cp "$RES_PATH"/config/sshd_config "$ROOTFS_PATH"/etc/sshd_config

rm -rf "$ROOTFS_PATH"/etc/ssh
ln -sf /var/local/etc/ssh "$ROOTFS_PATH"/etc/ssh

DEFAULT_SERVICES="${DEFAULT_SERVICES} sshd"
