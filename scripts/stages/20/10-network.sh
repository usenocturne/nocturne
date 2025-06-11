#!/bin/sh

#xbps-install -r "$ROOTFS_PATH" -y NetworkManager

cp -a "$SCRIPTS_PATH"/services/usb-gadget "$ROOTFS_PATH"/etc/sv/
DEFAULT_SERVICES="${DEFAULT_SERVICES} usb-gadget"

#cat > "$ROOTFS_PATH"/etc/NetworkManager/NetworkManager.conf << EOF
#[main]
#dhcp=internal
#dns=default
#rc-manager=file
#EOF

#cat > "$ROOTFS_PATH"/etc/NetworkManager/system-connections/usb0.nmconnection << EOF
#[connection]
#id=usb0
#type=ethernet
#interface-name=usb0
#autoconnect=true

#[ipv4]
#method=manual
#address1=172.16.42.2/24,172.16.42.1
#dns=1.1.1.1;8.8.8.8;
#EOF
#chmod 600 "$ROOTFS_PATH"/etc/NetworkManager/system-connections/usb0.nmconnection

#echo "ENV{DEVTYPE}==\"gadget\", ENV{NM_UNMANAGED}=\"0\"" > "$ROOTFS_PATH"/usr/lib/udev/rules.d/98-network.rules

#DEFAULT_SERVICES="${DEFAULT_SERVICES} NetworkManager"
