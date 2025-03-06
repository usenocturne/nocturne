#!/bin/sh

chroot_exec apk add dnsmasq

cat >> "$ROOTFS_PATH"/etc/network/interfaces.alpine-builder <<EOF

auto usb0
iface usb0 inet static
    address 172.16.42.2/24
    gateway 172.16.42.1
EOF

cp "$ROOTFS_PATH"/etc/network/interfaces.alpine-builder "$DATAFS_PATH"/etc/network/interfaces

cat > "$ROOTFS_PATH"/etc/dnsmasq.conf <<EOF
interface=usb0
local=/superbird/
dhcp-range=172.16.42.1,172.16.42.1,255.255.255.0,1m
dhcp-option=option:router,172.16.42.1
server=1.1.1.1
server=8.8.8.8
dhcp-leasefile=/data/dnsmasq.leases
EOF

install ${RES_PATH}/scripts/usbgadget.sh ${ROOTFS_PATH}/etc/init.d/usbgadget

chroot_exec rc-update add dnsmasq default
chroot_exec rc-update add usbgadget default


