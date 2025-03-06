#!/sbin/openrc-run

name="nocturned"
supervisor="supervise-daemon"
command="/usr/sbin/nocturned"

depend() {
    need localmount
    after dbus bluetooth
}
