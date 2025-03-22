#!/bin/sh

chroot_exec apk add dnsmasq

cat >> "$ROOTFS_PATH"/etc/network/interfaces.alpine-builder << EOF

auto bnep0
iface bnep0 inet dhcp

auto usb0
iface usb0 inet static
    address 172.16.42.2/24
    gateway 172.16.42.1
    dns-nameservers 1.1.1.1 8.8.8.8 2606:4700:4700::1111 2001:4860:4860::8888
EOF

cp "$ROOTFS_PATH"/etc/network/interfaces.alpine-builder "$DATAFS_PATH"/etc/network/interfaces

cat > "$ROOTFS_PATH"/etc/dnsmasq.conf << EOF
interface=usb0
local=/superbird/
dhcp-range=172.16.42.1,172.16.42.1,255.255.255.0,1m
dhcp-option=option:router,172.16.42.1
server=1.1.1.1
server=8.8.8.8
server=2606:4700:4700::1111
server=2001:4860:4860::8888
dhcp-leasefile=/data/etc/dnsmasq/dnsmasq.leases
EOF

mkdir -p "$DATAFS_PATH"/etc/dnsmasq
sed -i 's|/var/lib/misc/|/data/etc/dnsmasq/|' "$ROOTFS_PATH"/etc/init.d/dnsmasq

DEFAULT_SERVICES="${DEFAULT_SERVICES} dnsmasq"
