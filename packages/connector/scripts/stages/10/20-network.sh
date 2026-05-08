#!/bin/sh

"$HELPERS_PATH"/chroot_exec.sh apk add wireless-tools wpa_supplicant wpa_supplicant-openrc nftables eudev udev-init-scripts linux-firmware-brcm bluez bluez-openrc dbus dbus-openrc wireless-regdb iw

mkdir -p "$ROOTFS_PATH"/etc/wpa_supplicant
cat > "$ROOTFS_PATH"/etc/wpa_supplicant/wpa_supplicant.conf << EOF
ctrl_interface=/run/wpa_supplicant
update_config=1
country=US
EOF

sed -i '\|default_conf=/etc/wpa_supplicant/wpa_supplicant.conf|a \
  ifup wlan0' "$ROOTFS_PATH"/etc/init.d/wpa_supplicant

cat > "$ROOTFS_PATH"/etc/network/interfaces <<'EOF'
auto lo
iface lo inet loopback

auto wlan0
iface wlan0 inet dhcp

auto eth0
iface eth0 inet dhcp
    pre-up sh -c 'if grep -q "^network={" /etc/wpa_supplicant/wpa_supplicant.conf 2>/dev/null; then echo "[eth0] Wi-Fi configured; skipping to avoid DHCP timeout" >&2; exit 1; fi'

auto usb0
iface usb0 inet static
    address 172.16.42.1/24

EOF

echo "net.ipv4.ip_forward=1" >> "$ROOTFS_PATH"/etc/sysctl.conf
echo "net.ipv6.conf.all.forwarding=1" >> "$ROOTFS_PATH"/etc/sysctl.conf

echo "172.16.42.2 nocturne" >> "$ROOTFS_PATH"/etc/hosts

rm -f "$ROOTFS_PATH"/etc/nftables.nft
cp "$RES_PATH"/config/nftables.nft "$ROOTFS_PATH"/etc/nftables.nft

echo 'SUBSYSTEM=="net", ACTION=="add", ATTRS{idVendor}=="0000", ATTRS{idProduct}=="1014", NAME="usb0", RUN+="/usr/local/bin/carthing-hotplug"' > "$ROOTFS_PATH"/usr/lib/udev/rules.d/carthing.rules

mkdir -p "$ROOTFS_PATH"/usr/local/bin
cat > "$ROOTFS_PATH"/usr/local/bin/carthing-hotplug << 'SCRIPT'
#!/bin/sh
setsid sh -c 'sleep 2; /sbin/ip addr add 172.16.42.1/24 dev usb0 2>/dev/null; /sbin/ip link set usb0 up' &
exit 0
SCRIPT
chmod +x "$ROOTFS_PATH"/usr/local/bin/carthing-hotplug

"$HELPERS_PATH"/chroot_exec.sh apk add chrony chrony-openrc
cat > "$ROOTFS_PATH"/etc/chrony/chrony.conf << EOF
pool pool.ntp.org iburst
driftfile /var/lib/chrony/chrony.drift
makestep 1.0 -1
rtcsync
EOF

DEFAULT_SERVICES="${DEFAULT_SERVICES} dbus bluetooth wpa_supplicant wpa_cli nftables udev-postmount chronyd"
SYSINIT_SERVICES="${SYSINIT_SERVICES} udev udev-trigger"
