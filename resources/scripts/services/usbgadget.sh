#!/sbin/openrc-run
# shellcheck shell=ash

depend() {
  need localmount
  before networking
}

printToKmsg() { echo "USB_GADGET: $1" && echo "USB_GADGET: $1" > /dev/kmsg; }
usbGadgetDir="/sys/kernel/config/usb_gadget/g1"

start() {
  ebegin Setting up USB gadget

  mount -t configfs none /sys/kernel/config/

  # Create USB gadget
  printToKmsg "Creating USB gadget"
  mkdir -p /sys/kernel/config/usb_gadget/g1
  echo 0x1d6b > "${usbGadgetDir}"/idVendor  # Linux Vendor ID
  echo 0x1014 > "${usbGadgetDir}"/idProduct # Multifunction Device ID
  echo 0x0100 > "${usbGadgetDir}"/bcdDevice # Device Version/Revision
  echo 0x0200 > "${usbGadgetDir}"/bcdUSB    # USB Version
  mkdir -p "${usbGadgetDir}"/strings/0x409  # English strings
  cat /sys/class/efuse/usid > "${usbGadgetDir}"/strings/0x409/serialnumber # Serial Number
  echo Spotify > "${usbGadgetDir}"/strings/0x409/manufacturer              # Manufacturer string
  echo Superbird > "${usbGadgetDir}"/strings/0x409/product                 # Device string

  # Convinces Windows to properly load RNDIS driver
  echo 1       > "${usbGadgetDir}"/os_desc/use # Tells gadget to use values in os_desc
  echo 0xcd    > "${usbGadgetDir}"/os_desc/b_vendor_code
  echo MSFT100 > "${usbGadgetDir}"/os_desc/qw_sign

  # Create the gadget config
  printToKmsg "Creating gadget config"
  mkdir "${usbGadgetDir}"/configs/c.1
  echo "500" > "${usbGadgetDir}"/configs/c.1/MaxPower

  # RNDIS
  mkdir -p "${usbGadgetDir}"/functions/rndis.usb0
  echo "a0:b1:c2:d3:e4:00" > "${usbGadgetDir}"/functions/rndis.usb0/dev_addr
  echo "a0:b1:c2:d3:e4:01" > "${usbGadgetDir}"/functions/rndis.usb0/host_addr
  echo RNDIS   > "${usbGadgetDir}"/functions/rndis.usb0/os_desc/interface.rndis/compatible_id
  echo 5162001 > "${usbGadgetDir}"/functions/rndis.usb0/os_desc/interface.rndis/sub_compatible_id
  sleep 1

  ln -s "${usbGadgetDir}"/functions/rndis.usb0 "${usbGadgetDir}"/configs/c.1
  ln -s "${usbGadgetDir}"/configs/c.1 "${usbGadgetDir}"/os_desc
  # Bind gadget to the USB device
  printToKmsg "Binding gadget to USB device"
  UDC_DEVICE=$(ls -1 /sys/class/udc/)
  echo "$UDC_DEVICE" > /sys/kernel/config/usb_gadget/g1/UDC

  printToKmsg "Configuring usb0"
  sleep 3 # Wait a few seconds to allow the interface to come up
  ip link set usb0 up

  eend $?
}

stop() {
  ebegin "Stopping USB"
	echo "" > /sys/kernel/config/usb_gadget/g1/UDC
  eend 0
}
