#!/sbin/openrc-run
# shellcheck shell=ash

# shellcheck disable=SC2034
name="nocturned"
supervisor="supervise-daemon"
command="/usr/sbin/nocturned"

depend() {
    need localmount
    after dbus bluetooth
}
