#!/sbin/openrc-run
# shellcheck shell=ash
# shellcheck disable=SC2034

description="Import WiFi config from boot partition"

depend() {
  before wpa_supplicant networking
  need localmount
}

find_wifi_config() {
  for name in wpa_supplicant wpa-supplicant; do
    for ext in "" .conf .txt; do
      if [ -f "/boot/${name}${ext}" ]; then
        echo "/boot/${name}${ext}"
        return 0
      fi
    done
  done
  return 1
}

import_config() {
  local src="$1"

  mkdir -p /etc/wpa_supplicant
  rm -f /etc/wpa_supplicant/wpa_supplicant.conf
  cp "$src" /etc/wpa_supplicant/wpa_supplicant.conf
  grep -q "ctrl_interface" /etc/wpa_supplicant/wpa_supplicant.conf || \
    sed -i '1i ctrl_interface=/run/wpa_supplicant' /etc/wpa_supplicant/wpa_supplicant.conf
  grep -q "update_config" /etc/wpa_supplicant/wpa_supplicant.conf || \
    sed -i '2i update_config=1' /etc/wpa_supplicant/wpa_supplicant.conf
}

start() {
  ebegin "Checking boot partition for WiFi config"

  src=$(find_wifi_config)
  if [ -n "$src" ]; then
    einfo "Found $(basename "$src") on boot partition, importing..."

    import_config "$src"

    mount -o remount,rw /boot 2>/dev/null
    rm -f "$src"
    mount -o remount,ro /boot 2>/dev/null

    einfo "WiFi config imported and removed from boot partition"
  fi

  eend 0
}
