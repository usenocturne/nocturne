#!/bin/sh

xbps-install -r "$ROOTFS_PATH" -y NetworkManager dhclient dnsmasq

cp -a "$SCRIPTS_PATH"/services/usb-gadget "$ROOTFS_PATH"/etc/sv/

cat > "$ROOTFS_PATH"/etc/NetworkManager/NetworkManager.conf << EOF
[main]
dhcp=dhclient
dns=default
rc-manager=file
EOF

cat > "$ROOTFS_PATH"/etc/NetworkManager/system-connections/usb0.nmconnection << EOF
[connection]
id=usb0
type=ethernet
interface-name=usb0
autoconnect=true

[ipv4]
method=manual
address1=172.16.42.2/24,172.16.42.1
dns=1.1.1.1;8.8.8.8;
EOF
chmod 600 "$ROOTFS_PATH"/etc/NetworkManager/system-connections/usb0.nmconnection

echo "ENV{DEVTYPE}==\"gadget\", ENV{NM_UNMANAGED}=\"0\"" > "$ROOTFS_PATH"/usr/lib/udev/rules.d/98-network.rules

cat > "$ROOTFS_PATH"/etc/dnsmasq.conf << EOF
interface=usb0
dhcp-range=172.16.42.2,172.16.42.254,255.255.255.0,1h
dhcp-host=a0:b1:c2:d3:e4:01,172.16.42.1
bind-interfaces
leasefile-ro
EOF

DEFAULT_SERVICES="${DEFAULT_SERVICES} usb-gadget NetworkManager dnsmasq"
