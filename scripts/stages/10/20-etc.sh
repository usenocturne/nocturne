#!/bin/sh

rm -f "$ROOTFS_PATH"/etc/motd "$ROOTFS_PATH"/etc/fstab
cp "$RES_PATH"/config/motd "$ROOTFS_PATH"/etc/motd
cp "$RES_PATH"/config/fstab "$ROOTFS_PATH"/etc/fstab

echo "$DEFAULT_HOSTNAME" > "$ROOTFS_PATH"/etc/hostname

root_pw=$(mkpasswd -m sha-512 -s "$DEFAULT_ROOT_PASSWORD")
sed -i "/^root/d" "$ROOTFS_PATH"/etc/shadow
echo "root:${root_pw}:19000:0:99999::::" >> "$ROOTFS_PATH"/etc/shadow
"$HELPERS_PATH"/chroot_exec.sh chsh -s /bin/bash root

cat > "$ROOTFS_PATH"/etc/network/interfaces << EOF
auto lo
iface lo inet loopback

auto bnep0
iface bnep0 inet dhcp
EOF
