#!/bin/bash

# Setup Linux USB Gadget for just rndis
#   this version is meant to run within native debian on the device

# Available options:

# usb_f_rndis.ko
# usb_f_fs.ko
# usb_f_midi.ko
# usb_f_mtp.ko
# usb_f_ptp.ko
# usb_f_audio_source.ko
# usb_f_accessory.ko


######### Variables

SERIAL_NUMBER="12345678"
# 18d1:4e40 Google Inc. Nexus 7
ID_VENDOR="0x18d1"
ID_PRODUCT="0x4e40"
MANUFACTURER="Spotify"
PRODUCT="Superbird"
# ADBD_LOG_FILE="/tmp/adbd.log"


# Research
#   starting point: https://github.com/frederic/superbird-bulkcmd/blob/main/scripts/enable-adb.sh.client
#   info about configfs https://elinux.org/images/e/ef/USB_Gadget_Configfs_API_0.pdf
#   info about usbnet and bridging https://developer.ridgerun.com/wiki/index.php/How_to_use_USB_device_networking
#   more info, including for windows https://learn.adafruit.com/turning-your-raspberry-pi-zero-into-a-usb-gadget/ethernet-gadget
#   a gist that was helpful: https://gist.github.com/geekman/5bdb5abdc9ec6ac91d5646de0c0c60c4
#   https://www.kernel.org/doc/Documentation/usb/gadget_configfs.txt

######### Functions

create_device() {
	# create usb gadget device
	ID_VEND="$1"
	ID_PROD="$2"
	BCD_DEVICE="$3"
	BCD_USB="$4"
	echo "###  Creating device $ID_VEND $ID_PROD"
	mkdir -p "/dev/usb-ffs"
	mkdir -p "/dev/usb-ffs/adb"
	mountpoint /sys/kernel/config/ || mount -t configfs none "/sys/kernel/config/"
	mkdir -p "/sys/kernel/config/usb_gadget/g1"
	echo "$ID_VEND" > "/sys/kernel/config/usb_gadget/g1/idVendor"
	echo "$ID_PROD" > "/sys/kernel/config/usb_gadget/g1/idProduct"
	echo "$BCD_DEVICE" > "/sys/kernel/config/usb_gadget/g1/bcdDevice"
	echo "$BCD_USB" > "/sys/kernel/config/usb_gadget/g1/bcdUSB"
	mkdir -p "/sys/kernel/config/usb_gadget/g1/strings/0x409"
	sleep 1
}

configure_device() {
	# configure usb gadget device
	MANUF="$1"
	PROD="$2"
	SERIAL="$3"
	CONFIG_NAME="$4"
	echo "###  Configuring device as $MANUF $PROD"
	echo "$MANUF" > "/sys/kernel/config/usb_gadget/g1/strings/0x409/manufacturer"
	echo "$PROD" > "/sys/kernel/config/usb_gadget/g1/strings/0x409/product"
	echo "$SERIAL" > "/sys/kernel/config/usb_gadget/g1/strings/0x409/serialnumber"
	mkdir -p "/sys/kernel/config/usb_gadget/g1/configs/c.1"
	mkdir -p "/sys/kernel/config/usb_gadget/g1/configs/c.1/strings/0x409"
	echo "$CONFIG_NAME" > "/sys/kernel/config/usb_gadget/g1/configs/c.1/strings/0x409/configuration"
	echo 500 > "/sys/kernel/config/usb_gadget/g1/configs/c.1/MaxPower"
	ln -s "/sys/kernel/config/usb_gadget/g1/configs/c.1" "/sys/kernel/config/usb_gadget/g1/os_desc/c.1"
	sleep 1
}

add_function(){
	# add a function to existing config id
	FUNCTION_NAME="$1"
	echo "###  adding function $FUNCTION_NAME to config c.1"
	mkdir -p "/sys/kernel/config/usb_gadget/g1/functions/${FUNCTION_NAME}"
	ln -s "/sys/kernel/config/usb_gadget/g1/functions/${FUNCTION_NAME}" "/sys/kernel/config/usb_gadget/g1/configs/c.1"
}

start_adb_daemon() {
	# mount adb functionfs and start daemon
	LOG_FILE="$1"
	echo "###  starting adb daemon"
	mkdir -p /dev/usbgadget/adb
	mount -t functionfs adb /dev/usbgadget/adb
	if [ ! -f "/usr/bin/adbd" ]; then
		echo "Unable to find adbd binary!"
	else
		/usr/bin/adbd > "$LOG_FILE" 2>&1 &
		echo "$!" > /tmp/adbd.pid
	fi
	sleep 5s
}

attach_driver(){
	# attach the created gadget device to our UDC driver
	UDC_DEVICE=$(/bin/ls -1 /sys/class/udc/)  # ff400000.dwc2_a
	echo "###  Attaching gadget to UDC device: $UDC_DEVICE"
	echo "$UDC_DEVICE" > /sys/kernel/config/usb_gadget/g1/UDC
	sleep 1
}

configure_usbnet() {
	DEVICE="$1"
	NETWORK="$2"  # just the first 3 octets
	NETMASK="$3"
	echo "###  bringing up $DEVICE with ${NETWORK}.2"
	ifconfig "$DEVICE" up
	ifconfig "$DEVICE" "${NETWORK}.2" netmask "$NETMASK" broadcast "${NETWORK}.255"
	echo "adding routes for $DEVICE"
	ip route add default via "${NETWORK}.1" dev "$DEVICE"
	echo "making sure you have a dns server"
	echo "nameserver 1.1.1.1" > /etc/resolv.conf
	sleep 1
}

shutdown_gadget() {
	# shutdown and clean up usb gadget and services
	#   ref: https://wiki.tizen.org/USB/Linux_USB_Layers/Configfs_Composite_Gadget/Usage_eq._to_g_ffs.ko
	echo "$UDC_DEVICE" > /sys/kernel/config/usb_gadget/g1/UDC
	if [ -f "/tmp/adbd.pid" ]; then
		kill -9 "$(cat /tmp/adbd.pid)"
		umount /dev/usbgadget/adb
	fi
	find "/sys/kernel/config/usb_gadget/g1/configs/c.1" -type l -exec unlink {} \;
	rm -r "/sys/kernel/config/usb_gadget/g1/configs/c.1/strings/0x409"
	rm -r /sys/kernel/config/usb_gadget/g1/strings/0x409
	rm -r "/sys/kernel/config/usb_gadget/g1/configs/c.1"
	rm -r /sys/kernel/config/usb_gadget/g1/functions/*
	rm -r /sys/kernel/config/usb_gadget/g1/

}

######### Entrypoint

echo "### Configuring USB Gadget with adb and rndis"
create_device "$ID_VENDOR" "$ID_PRODUCT" "0x0223" "0x0200"
configure_device "$MANUFACTURER" "$PRODUCT" "$SERIAL_NUMBER" "Multi-Function Device"

add_function "rndis.usb0"  # rndis usb ethernet

# add_function "ffs.adb"  # adb
# start_adb_daemon "$ADBD_LOG_FILE"

attach_driver

configure_usbnet "usb0" "192.168.7" "255.255.255.0"

echo "Done setting up USB Gadget"
