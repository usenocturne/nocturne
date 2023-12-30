#!/bin/sh
# shellcheck disable=SC2129

# create debian rootfs in the given device or file
# NOTE: you need to grab modules from inside system_a.ext2, they are in lib/modules, take that whole folder

# add --local_proxy as 2nd argument to try to use local instance of apt-cacher-ng at localhost:3142

# this script is limited to features supported by sh (instead of bash), so that it can run from the stock superbird os

################################################ User Variables ################################################

HOST_NAME="superbird"
USER_NAME="superbird"

# USER_PASSWORD="superbird"
# generate hash: openssl passwd -6 "superbird"
#   shellcheck disable=SC2016
USER_PASS_HASH='$6$zeM8ZwO/Xke05h6X$UtmM0sIBznj4hxmd/UGUO1YHUr0emOn.9u7G1yQRVGR4XutYCstDzVLzpUw9PNWrhYRAEg73ovkC4JNPFlSmI1'

INSTALL_PATH="/mnt/root_data"  # this is where we will mount the partition to do our install
ARCHITECTURE="arm64"

DISTRO_REPO_URL="http://deb.debian.org/debian/"
DISTRO_BRANCH="trixie"
DISTRO_VARIANT="minbase"

TIMEZONE="America/Los_Angeles"
LOCALE="en_US.UTF-8"
SERIAL_BAUD="115200"

# init system, either systemd or sysvinit
#   without systemd-sysv, no reboot/shutdown commands
PACKAGES="systemd systemd-sysv dbus kmod"
# base packages
PACKAGES="$PACKAGES usbutils htop nano tree file less locales sudo dialog apt"
# stuff for networking
PACKAGES="$PACKAGES wget curl iputils-ping iputils-tracepath iputils-arping iproute2 net-tools openssh-server ntp"
# minimal xorg
PACKAGES="$PACKAGES xserver-xorg-core xserver-xorg-video-fbdev xterm xinit x11-xserver-utils shared-mime-info"
# xorg input
PACKAGES="$PACKAGES xserver-xorg-input-evdev libinput-bin xserver-xorg-input-libinput xinput"
# additional required tools
PACKAGES="$PACKAGES fbset x11vnc"

# NOTE: we cannot install chromium at at the debootstrap stage, because dbus cannot be properly configured
#   so we install chromium in a separate stage using chroot

STAGE2_PACKAGES="chromium python3-minimal python3-pip"

################################################ Running Variables ################################################

CSV_PACKAGES=$(echo "$PACKAGES"| tr ' ' ',')  # need comma-separated list of packages for debootstrap


################################################ Functions ################################################

in_target() {
	# run command(s) within the chroot
	chroot "${INSTALL_PATH}" "$@"
}

install_script() {
	# copy the named script into target /scripts/ and make it executable, owned by superbird
	SCR_NAME="$1"
	echo "Installing script: $SCR_NAME"
	cp "./scripts/$SCR_NAME" "${INSTALL_PATH}/scripts/$SCR_NAME"
	chmod +x "${INSTALL_PATH}/scripts/$SCR_NAME"
	in_target chown $USER_NAME "/scripts/$SCR_NAME"
}

install_service() {
	# copy named service file into taret /lib/systemd/system/, symlink it into multi-user.target.wants, and make it owned by superbird
	SVC_NAME="$1"
	echo "Installing service: $SVC_NAME"
	cp "./systemd/$SVC_NAME" "${INSTALL_PATH}/lib/systemd/system/$SVC_NAME"
	in_target chown $USER_NAME "/lib/systemd/system/$SVC_NAME"
	in_target ln -s "/lib/systemd/system/$SVC_NAME" "/etc/systemd/system/multi-user.target.wants/$SVC_NAME"
}


################################################ Entrypoint ################################################

# need to be root
if [ "$(id -u)" != "0" ]; then
	echo "Must be run as root"
	exit 1
fi

TARGET_PARTITION="$1"
if [ -z "$TARGET_PARTITION" ]; then
	echo "Need to provide a target device/partition or file"
	echo "	if target is a file, it must already exist"
	echo "ex: $0 /dev/data"
	exit 1
fi

if [ ! -f "$TARGET_PARTITION" ] && [ ! -b "$TARGET_PARTITION" ]; then
	echo "Could not find target: $TARGET_PARTITION"
	exit 1
fi


if [ ! -d "./modules/4.9.113" ]; then
	echo "Could not find kernel modules at ./modules/4.9.113"
	echo "	need to grab /lib/modules from system_a.ext2 and place it in the current directory"
	exit 1
fi

set -e

echo "Going to install Debian $DISTRO_BRANCH $DISTRO_VARIANT $ARCHITECTURE on $TARGET_PARTITION"


################################################ Format Partition ################################################

echo "formatting $TARGET_PARTITION"
mountpoint "$INSTALL_PATH" && umount "$INSTALL_PATH"
mkfs.ext4 -F "$TARGET_PARTITION" || {
	echo "failed to format (or user cancelled format), quitting"
	exit 1
}
mkdir -p "$INSTALL_PATH"

if [ -b "$TARGET_PARTITION" ]; then
	echo "mounting block device"
	mount "$TARGET_PARTITION" "$INSTALL_PATH"
else
	echo "mounting file using loopback"
	mount -o loop "$TARGET_PARTITION" "$INSTALL_PATH"
fi


################################################ Install Packages ################################################
echo "Installing packages: $CSV_PACKAGES"
echo ""
echo "Debootstrap: debootstrap --variant=$DISTRO_VARIANT --no-check-gpg --arch=$ARCHITECTURE $DISTRO_BRANCH $INSTALL_PATH $DISTRO_REPO_URL"
echo ""

# use local apt-cacher-ng instance
if [ "$2" = "--local_proxy" ]; then
	export http_proxy=http://127.0.0.1:3142
	echo "Using local apt-cacher-ng proxy at: ${http_proxy}"
fi

debootstrap --verbose --variant="$DISTRO_VARIANT" --no-check-gpg --include="$CSV_PACKAGES" --arch="$ARCHITECTURE" "$DISTRO_BRANCH" "$INSTALL_PATH" "$DISTRO_REPO_URL"

in_target apt update
in_target apt install -y --no-install-recommends --no-install-suggests $STAGE2_PACKAGES

mkdir -p "${INSTALL_PATH}/scripts"
cp "./scripts/requirements.txt" "${INSTALL_PATH}/scripts/requirements.txt"
in_target python3 -m pip install -r /scripts/requirements.txt --break-system-packages


################################################ Copy Kernel Modules ################################################

echo "Copying over kernel modules"
cp -r ./modules "${INSTALL_PATH}/lib/"


################################################ Setup Xorg ################################################

echo "creating xorg.conf"
mkdir -p "${INSTALL_PATH}/etc/X11"
cp ./xorg/portrait.conf "${INSTALL_PATH}/etc/X11/xorg.conf"

# need to disable the scripts that try to autodetect input devices, they cause double input
# 	this is particularly evident when in landscape mode, as only one of the two inputs is correctly transformed for the rotation
# 	these files were installed by xserver-xorg-input-libinput
in_target mv /usr/share/X11/xorg.conf.d /usr/share/X11/xorg.conf.d.bak


################################################ Configure serial console ################################################

echo "adding ttyS0 console at $SERIAL_BAUD to inittab"
echo 'T0:23:respawn:/sbin/getty -L ttyS0 '"$SERIAL_BAUD"' vt100' >> "${INSTALL_PATH}/etc/inittab"


################################################ Setup Hostname and Hosts ################################################

echo "Setting hostname"
echo "$HOST_NAME" > "${INSTALL_PATH}/etc/hostname"

echo "Generating /etc/hosts"

HOSTS_CONTENT=$(
	cat <<- EOHF
	# generated by $0
	127.0.0.1     localhost
	127.0.0.1     $HOST_NAME
	::1           localhost $HOST_NAME ip6-localhost ip6-loopback
	ff02::1		ip6-allnodes
	ff02::2       ip6-allrouters
	192.168.7.1   host
	EOHF
)
echo "$HOSTS_CONTENT" > "${INSTALL_PATH}/etc/hosts"


################################################ Setup user accounts ################################################

# NOTE: you could set the root password here, but you need to do it interactively
# in_target passwd

echo "Creating regular user (with sudo rights): $USER_NAME"

in_target useradd -p "$USER_PASS_HASH" --shell /bin/bash "$USER_NAME"
in_target mkdir -p "/home/${USER_NAME}"
in_target chown "${USER_NAME}":"${USER_NAME}" "/home/${USER_NAME}"
in_target chmod 700 "/home/${USER_NAME}"

# let user use sudo without password
echo "$USER_NAME ALL=(ALL) NOPASSWD: ALL" >> "${INSTALL_PATH}/etc/sudoers"

set +e  # ok if some of these fail
in_target usermod -aG cdrom "$USER_NAME"
in_target usermod -aG floppy "$USER_NAME"
in_target usermod -aG sudo "$USER_NAME"
in_target usermod -aG audio "$USER_NAME"
in_target usermod -aG dip "$USER_NAME"
in_target usermod -aG video "$USER_NAME"
in_target usermod -aG plugdev "$USER_NAME"
# in_target usermod -aG netdev "$USER_NAME"
# in_target usermod -aG ssh "$USER_NAME"
set -e


################################################ Setup scripts and services ################################################



install_script setup_usbgadget.sh
install_service usbgadget.service

install_script setup_display.sh
install_script clear_display.sh

install_script setup_vnc.sh
install_service vnc.service

install_script start_buttons.sh
install_script buttons_app.py
install_script buttons_settings.py
install_service buttons.service

install_script setup_backlight.sh
install_service backlight.service

install_script start_chromium.sh
install_script chromium_settings.sh
install_service chromium.service

in_target chown -R $USER_NAME /scripts


################################################ Cleanup systemd and timezone stuff ################################################

echo "making sure symlinks exist for systemd"
in_target ln -sf "/usr/bin/systemd" "/usr/sbin/init"  # package systemd-sysv does this too
in_target ln -sf "/lib/systemd/system/getty@.service" "/etc/systemd/system/getty.target.wants/getty@ttyS0.service"

echo "Setting timezone to $TIMEZONE"
echo "$TIMEZONE" > "${INSTALL_PATH}/etc/timezone"
ln -sf "${INSTALL_PATH}/usr/share/zoneinfo/$TIMEZONE" "${INSTALL_PATH}/etc/localtime"
in_target dpkg-reconfigure -f noninteractive tzdata

echo "Generating locales for $LOCALE"
sed -i -e 's/# '"$LOCALE"' UTF-8/'"$LOCALE"' UTF-8/' "${INSTALL_PATH}/etc/locale.gen"
echo "LANG=\"${LOCALE}\"" > "${INSTALL_PATH}/etc/default/locale"
in_target dpkg-reconfigure --frontend=noninteractive locales



################################################ Done! ################################################

echo "synching disk changes"
sync

echo "Filesystem      Size  Used Avail Use% Mounted on"
df -h |grep "$INSTALL_PATH"

echo "Un-mounting $INSTALL_PATH"
umount "$INSTALL_PATH"

echo "Done installing debian to: $TARGET_PARTITION"
