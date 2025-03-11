#!/sbin/openrc-run
# shellcheck shell=ash

# shellcheck disable=SC2034
name="Bluetooth Adapter"
supervisor="supervise-daemon"
command="/usr/bin/btattach"
command_args="-P bcm -B /dev/ttyS1"

depend() {
  need localmount
  before bluetooth
}

start_pre() {
  GPIOX_17=493
  if [ ! -f /sys/class/gpio/gpio493/direction ]; then
    echo ''${GPIOX_17} > /sys/class/gpio/export
    echo out > /sys/class/gpio/gpio493/direction
  fi

  # Pull the gpio pin down to reset chip
  echo 0 > /sys/class/gpio/gpio493/value
  sleep 0.1

  # Turn off reset
  echo 1 > /sys/class/gpio/gpio493/value

  # Give the chip some time to start
  sleep 0.3
}
