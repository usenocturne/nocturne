#!/bin/sh

# use hostname in /etc/hostname for dhcp
sed -E "s/eval echo .IF_DHCP_HOSTNAME/cat \/etc\/hostname/" -i "$ROOTFS_PATH"/usr/libexec/ifupdown-ng/dhcp

cat > "$DATAFS_PATH"/etc/network/interfaces <<EOF2
auto lo
iface lo inet loopback
EOF2

cp "$DATAFS_PATH"/etc/network/interfaces "$ROOTFS_PATH"/etc/network/interfaces.alpine-builder

# udhcpc & resolv.conf
mkdir -p "$ROOTFS_PATH"/etc/udhcpc
echo "RESOLV_CONF=/data/etc/resolv.conf" > "$ROOTFS_PATH"/etc/udhcpc/udhcpc.conf
