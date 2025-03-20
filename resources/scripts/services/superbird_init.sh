#!/sbin/openrc-run
# shellcheck shell=ash

depend() {
  need localmount
  before bluetooth bluetooth-adapter
}

start() {
  ebegin superbird_init

  # Bluetooth configuration
  name=""
  serial="$(tail -c 5 < /sys/class/efuse/usid)"
  bt_mac="$(/usr/bin/awk -F: '/0x00/ { split(toupper($2), s, " ") ; printf("%s:%s:%s:%s:%s:%s\n", s[1], s[2], s[3], s[4], s[5], s[6]) }' /sys/class/efuse/mac_bt)"
  if [ "${#serial}" -eq 4 ] && [ "${#bt_mac}" -eq 17 ]; then
    name="Nocturne (${serial})"
  else
    name="Nocturne"
  fi

  bt_settings_path="/var/lib/bluetooth/${bt_mac}"
  if [ ! -f "${bt_settings_path}/settings" ]; then
    mkdir -p "$bt_settings_path"
    printf "[General]\nAlias=%s\n" "$name" > "${bt_settings_path}/settings"
  fi

  eend $?
}
