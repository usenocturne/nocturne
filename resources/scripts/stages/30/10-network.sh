#!/bin/sh

chroot_exec apk add networkmanager networkmanager-cli networkmanager-dnsmasq dnsmasq openresolv

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

cat >> "$ROOTFS_PATH"/etc/NetworkManager/NetworkManager.conf << EOF
[main]
dhcp=internal
dns=dnsmasq
rc-manager=resolvconf
EOF

DEFAULT_SERVICES="${DEFAULT_SERVICES} networkmanager"
