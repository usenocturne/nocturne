#!/usr/bin/env bash

#SCRIPT NAME: setup_host_rpi
#AUTHOR(s): https://github.com/usenocturne/nocturne-image/
#DESCRIPTION: Configures a Raspberry Pi running Debian Bullseye to be a network passthrough device for the Spotify CarThing running custom firmware.

set -e  # bail on any errors

#Set terminal as non-interactive to prevent apt from prompting with proposed config changes and accepts defualts instead.
export DEBIAN_FRONTEND=noninteractive

# VARIABLES
HOST_NAME="superbird"
USBNET_PREFIX="192.168.7"  # usb network will use .1 as host device, and .2 for superbird
CT_INTERFACE="usb0" # Typically usb0 but can appear as eth0 depending on network manager. This assumption will be programatically determined at a later date
WAN_INTERFACE="wlan0" # Assuming you have a PiZero it's always going to be wlan0 unless you connect a USB NIC.
NET_ADAPTERS=($(ip link | grep -oE '\b(eth[0-9]+|wlan[0-9]+)\b'))
DEV_MODE=0

# FUNCTIONS
function remove_if_exists() {
    # Remove a file if it exists
    FILEPATH="$1"
    if [ -f "$FILEPATH" ]; then
        echo "found ${FILEPATH}, removing"
        rm "$FILEPATH"
    fi
}

function append_if_missing() {
    # Append string to file only if it does not already exist in the file
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

function forward_port() {
    # Usage: forward_port <host port> <superbird port>
    # Forwards a tcp port to access service on superbird via host.
    # If no superbird port is provided, same port number is used for both.
    SOURCE="$1"
    DEST="$2"
    if [ -z "$DEST" ]; then
        DEST="$SOURCE"
    fi
    iptables -t nat -A PREROUTING -p tcp -i "${WAN_INTERFACE}" --dport "$SOURCE" -j DNAT --to-destination "${USBNET_PREFIX}.2:$DEST"
    iptables -A FORWARD -p tcp -d "${USBNET_PREFIX}.2" --dport "$DEST" -m state --state NEW,ESTABLISHED,RELATED -j ACCEPT
}

# PRE_FLIGHT_CHECKS

# Need to be root
if [ "$(id -u)" != "0" ]; then
    echo "Must be run as root"
    exit 1
fi

# Does not run on BSD
if [ "$(uname -s)" != "Linux" ]; then
    echo "Only works on Linux!"
    exit 1
fi

# Does not run on anything but Raspbian Bullseye
if ! lsb_release -a | grep -q "Raspbian GNU/Linux 11 (bullseye)"; then
    echo "Current OS not supported! Only Raspbian Bullseye is supported at the moment."
    exit 1
fi

# Detect if usb0 CarThing NIC is already configured.
if ! ip addr show "${CT_INTERFACE}" | grep -q "${USBNET_PREFIX} "; then
    echo "No inactive network interface found. This may occur if the script was already run, or if your Spotify Car Thing is not plugged in."
    exit 1
fi

# Detect if car thing is plugged in
if lsusb | grep -q "Google Inc."
then
    echo "Car Thing detected, proceeding with setup"
else
    echo "Car Thing not detected. Please plug in the Car Thing and try again"
    exit 1
fi

# Detect if multiple NIC are present and select one
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

# If multiple NICs are not present set default WAN_INTERFACE
if printf '%s\n' "${NET_ADAPTERS[@]}" | grep -q '^eth'; then
    # Set NIC to only available eth interface
    WAN_INTERFACE="${NET_ADAPTERS[0]}"
    echo "Only one Ethernet interface detected, using $WAN_INTERFACE..."
else
    # Set NIC to only available wlan interface
    WAN_INTERFACE="${NET_ADAPTERS[0]}"
    echo "Only one WiFi interface detected, using $WAN_INTERFACE..."
fi

# Ask if user wants ports forwarded for ssh, vnc, and debugging
read -p "Do you want to enable dev mode to have remote access to the CarThing? (y/N): " dev_response
case "$dev_response" in
    [Yy]* )
        echo "Dev mode will be enabled!"
        DEV_MODE=1
        ;;
    [Nn]* )
        echo "Dev mode will not be enabled!"
        DEV_MODE=0
        ;;
    * )
        echo "Invalid input! Assuming no, dev mode will not be enabled!"
        DEV_MODE=0
        ;;
esac

# MAIN_SCRIPT

# Update system
echo "Updating repositories and packages..."
apt -qq update -y > /dev/null
apt -qq upgrade -y > /dev/null

# Gather deps
echo "Installing deps..."
apt install -qq iptables iptables-persistent -y > /dev/null

# Fix usb enumeration when connecting superbird in maskroom mode
echo "Applying USB fixes..."
echo '# Amlogic S905 series can be booted up in Maskrom Mode, and it needs a rule to show up correctly' > /etc/udev/rules.d/70-carthing-maskrom-mode.rules
echo 'SUBSYSTEM=="usb", ENV{DEVTYPE}=="usb_device", ATTR{idVendor}=="1b8e", ATTR{idProduct}=="c003", MODE:="0666", SYMLINK+="worldcup"' >> /etc/udev/rules.d/70-carthing-maskrom-mode.rules

# Prevent systemd / udev from renaming usb network devices by mac address
remove_if_exists /lib/systemd/network/73-usb-net-by-mac.link
remove_if_exists /lib/udev/rules.d/73-usb-net-by-mac.rules

# Allow IP forwarding
echo "Enabling IP forwarding..."
append_if_missing "net.ipv4.ip_forward = 1" /etc/sysctl.conf || {
    sysctl -p  # reload from conf
}

# Forwarding rules
mkdir -p /etc/iptables

# Clear all iptables rules
echo "Clearing iptables..."

iptables -F
iptables -X
iptables -Z 
iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X
iptables -t raw -F
iptables -t raw -X

# Rewrite iptables rules
echo "Writing iptables rules..."

iptables -P FORWARD ACCEPT
iptables -A FORWARD -o "${WAN_INTERFACE}" -i "${CT_INTERFACE}" -s "${USBNET_PREFIX}.0/24" -m conntrack --ctstate NEW -j ACCEPT
iptables -A FORWARD -o "${WAN_INTERFACE}" -i "${CT_INTERFACE}" -s "${USBNET_PREFIX}.0/24" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A POSTROUTING -t nat -j MASQUERADE -s "${USBNET_PREFIX}.0/24"

# Forward ports if dev mode was enabled
if [ "$DEV_MODE" -eq 1 ]; then
    echo "Setting up Dev Mode..."
    echo "Forwarding port: 2022:22"
    forward_port 2022 22
    echo "Forwarding port: 5900:5900"
    forward_port 5900
    echo "Forwarding port: 9222:9222"
    forward_port 9222
else
    echo "Skipping Dev Mode setup..."
fi

# Save iptables rules to file
iptables-save > /etc/iptables/rules.v4

# Write the config changes for usb network
echo "Writing config for $CT_INTERFACE..."

mkdir -p /etc/network/interfaces.d/

cat << EOF > /etc/network/interfaces.d/usb0
# generated by $0
allow-hotplug usb0
iface usb0 inet static
	address ${USBNET_PREFIX}.1
	netmask 255.255.255.0
EOF

# Add superbird (CarThing) to /etc/hosts
append_if_missing "${USBNET_PREFIX}.2  ${HOST_NAME}"  "/etc/hosts"

echo "Need to reboot for all changes to take effect!"

exit 0
