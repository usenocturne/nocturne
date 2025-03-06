#!/sbin/openrc-run
# shellcheck shell=ash

# shellcheck disable=SC2034
description="Sets the local clock to the mtime of a given file."
clock_file=${clock_file:-/etc/rc.conf}

depend() {
  provide clock
  need dev
  keyword -docker -lxc -openvz -prefix -systemd-nspawn -uml -vserver -xenu
}

# swclock is an OpenRC built in

start() {
  ebegin "Setting the local clock based on last shutdown time"
  # need to mount data to read save file
  mount /data || MOUNTED="YES"
  swclock "$clock_file"
  [ -z "$MOUNTED" ] && umount /data
  eend 0
}

stop() {
  ebegin "Saving the shutdown time"
  mount /data || MOUNTED="YES"
  swclock --save "$clock_file"
  [ -z "$MOUNTED" ] && umount /data
  eend 0
}
