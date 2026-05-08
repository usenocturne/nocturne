#!/sbin/openrc-run
# shellcheck shell=ash
# shellcheck disable=SC2034

directory="/etc/nocturne-connector/api"
command="/usr/bin/bun"
command_args="run server/index.ts"
pidfile="/var/run/connector-api.pid"
command_background=true
output_log="/var/log/connector-api.log"
error_log="/var/log/connector-api.log"

depend() {
  need net dbus
  use logger wpa_supplicant bluetooth chronyd
  after wpa_supplicant bluetooth chronyd
}
