#!/usr/bin/env bash

# Configures a Raspberry Pi to be a network passthrough device for the Spotify Car Thing running custom firmware.

set -e # bail on any error

# set terminal as non-interactive to prevent apt from prompting for config changes; accepts defaults instead
export DEBIAN_FRONTEND=noninteractive

HOST_NAME="superbird"
USBNET_PREFIX="192.168.7" # usb network will use .1 as host device and .2 for superbird
# typically usb0 but can appear as eth0 depending on network manager.
# TODO: determine this interface name automatically
# in my testing, it seems that itll be ethX, where X is 0 (pi zero) or 1 (any pi with an ethernet port), but i will test more 
CT_INTERFACE="eth0"
WAN_INTERFACE="wlan0" # should be wlan0 for wifi, unless you connect a USB NIC
NET_ADAPTERS=($(ip link | grep -oE '\b(eth[0-9]+|wlan[0-9]+)\b'))
DEV_MODE=0

# Remove a file if it exists
function remove_if_exists() {
    FILEPATH="$1"
    if [ -f "$FILEPATH" ]; then
        echo "found ${FILEPATH}, removing"
        rm "$FILEPATH"
    fi
}

# Append string to file only if it does not already exist in the file
function append_if_missing() {
    STRING="$1"
    FILEPATH="$2"
    grep -q "$STRING" "$FILEPATH" || {
        echo "appending \"$STRING\" to $FILEPATH"
        echo "$STRING" >> "$FILEPATH"
        return 1
    }
    echo "Already found \"$STRING\" in $FILEPATH"
    return 0
}

# Usage: forward_port <host port> <superbird port>
# Forward a TCP port to access service on superbird via host.
# If no superbird port is provided, same port number is used for both.
function forward_port() {
    SOURCE="$1"
    DEST="$2"
    if [ -z "$DEST" ]; then
        DEST="$SOURCE"
    fi

    nft add rule ip nat prerouting tcp dport "$SOURCE" iifname "$WAN_INTERFACE" dnat to "${USBNET_PREFIX}.2:$DEST"
    nft add rule ip filter forward ip daddr "${USBNET_PREFIX}.2" tcp dport "$DEST" ct state new,established,related accept
}

if [ "$(id -u)" != "0" ]; then
    echo "Must be run as root"
    exit 1
fi

if [ "$(uname -s)" != "Linux" ]; then
    echo "Only works on Linux!"
    exit 1
fi

# detect if usb0 (Car Thing network) is already configured. 
# commented out since it still did not work
#if ! ip addr show "${CT_INTERFACE}" | grep -q "${USBNET_PREFIX} "; then
#    echo "No inactive network interface found. This may occur if the script was already run, or if your Spotify Car Thing is not plugged in."
#    exit 1
#fi

# detect if Car Thing is plugged in
if lsusb | grep -q "Google Inc."
then
    echo "Car Thing detected, proceeding with setup"
else
    echo "Car Thing not detected. Please plug in the Car Thing and try again"
    exit 1
fi

# detect if multiple NIC are present and select one
if [ "${#NET_ADAPTERS[@]}" -gt 1 ]; then
    NIC_ID=0
    echo "Multiple NICs found, please choose a network adapter that is connected to the internet"
    echo "Your options are: "
    for i in ${!NET_ADAPTERS[@]}; do
        echo "$i - ${NET_ADAPTERS[i]}"
    done
    echo ""
    read -p "Choice: " NIC_ID
    WAN_INTERFACE="${NET_ADAPTERS[NIC_ID]}"
fi

# if multiple NICs are not present set default WAN_INTERFACE
if printf '%s\n' "${NET_ADAPTERS[@]}" | grep -q '^eth'; then
    # set NIC to the only available eth interface
    WAN_INTERFACE="${NET_ADAPTERS[0]}"
    echo "Only one Ethernet interface detected, using $WAN_INTERFACE..."
else
    # set NIC to only available wlan interface
    WAN_INTERFACE="${NET_ADAPTERS[0]}"
    echo "Only one WiFi interface detected, using $WAN_INTERFACE..."
fi

# ask if user wants ports forwarded for ssh and remote debugging
read -p "Do you want to enable developer mode to have remote access (ssh/chrome remote debugging) to the Car Thing? (y/N): " dev_response
case "$dev_response" in
    [Yy]* )
        echo "Developer mode will be enabled!"
        DEV_MODE=1
        ;;
    [Nn]* )
        echo "Developer mode will not be enabled!"
        DEV_MODE=0
        ;;
    * )
        echo "Invalid input! Assuming no, dev mode will not be enabled!"
        DEV_MODE=0
        ;;
esac

# MAIN SCRIPT

echo "Updating repositories and packages..."
apt -qq -y update 
apt -qq -y upgrade 

echo "Installing deps..."
apt -qq -y install  nftables ifupdown 

# prevent systemd / udev from renaming usb network devices by mac address
remove_if_exists /lib/systemd/network/73-usb-net-by-mac.link
remove_if_exists /lib/udev/rules.d/73-usb-net-by-mac.rules

echo "Enabling IP forwarding..."
append_if_missing "net.ipv4.ip_forward = 1" /etc/sysctl.conf || {
    sysctl -p # reload from conf
}

mkdir -p /etc/iptables

# clear rules, and add new tables
echo "Setting up nftables..."
nft flush ruleset
nft add table ip filter
nft add table ip nat

# set new rules
nft add chain ip filter input { type filter hook input priority 0 \; }
nft add chain ip filter forward { type filter hook forward priority 0 \; }
nft add chain ip filter output { type filter hook output priority 0 \; }

nft add chain ip nat prerouting { type nat hook prerouting priority -100 \; }
nft add chain ip nat postrouting { type nat hook postrouting priority 100 \; }

nft add rule ip filter forward iifname "${CT_INTERFACE}" oifname "${WAN_INTERFACE}" ip saddr "${USBNET_PREFIX}.0/24" ct state new accept
nft add rule ip filter forward iifname "${CT_INTERFACE}" oifname "${WAN_INTERFACE}" ip saddr "${USBNET_PREFIX}.0/24" ct state established,related accept

nft add rule ip nat postrouting oifname "${WAN_INTERFACE}" masquerade

if [ "$DEV_MODE" -eq 1 ]; then
    echo "Setting up Dev Mode..."

    # ssh port, use port 2022 to connect
    echo "Forwarding SSH port: 2022:22"
    forward_port 2022 22

    # remote debugging port, use port 9222 to connect
    echo "Forwarding Remote Debugging port: 9222:9222"
    forward_port 9222
else
    echo "Skipping Dev Mode setup..."
fi

# save rules, enable and start nftables service
nft list ruleset > /etc/nftables.conf
systemctl enable nftables
systemctl start nftables

# stop networkmanager from managing interface that car thing is using
cat << EOF > /etc/NetworkManager/conf.d/99-unmanaged-interfaces.conf
# generated by $0
[keyfile]
unmanaged-devices=interface-name:$CT_INTERFACE
EOF

# write the config changes for usb network
echo "Writing config for $CT_INTERFACE..."

    cat << EOF > /etc/network/interfaces.d/$CT_INTERFACE
# generated by $0
auto $CT_INTERFACE
allow-hotplug $CT_INTERFACE
iface $CT_INTERFACE inet static
	address ${USBNET_PREFIX}.1
	netmask 255.255.255.0
EOF

# add Car Thing to /etc/hosts
append_if_missing "${USBNET_PREFIX}.2  ${HOST_NAME}"  "/etc/hosts"

echo "Need to reboot for all changes to take effect!"

exit 0
