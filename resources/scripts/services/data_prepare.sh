#!/sbin/openrc-run
# shellcheck shell=ash

depend() {
  need localmount
  before networking
}

start() {
  ebegin Checking persistent data

  if [ ! -d /data/etc ]; then
    # mount data with tmpfs if cannot create dir
    if ! mkdir -p /data/etc; then
      mount -t tmpfs -o size=12m tmpfs /data
      mkdir -p /data/etc
      ewarn Mounted tmpfs to /data needs manual recovery
    fi
  fi
  touch /data/etc/resolv.conf

  # check time zone config
  if [ ! -f /data/etc/timezone ]; then
    cp /etc/timezone.alpine-builder /data/etc/timezone
    ln -fs /usr/share/zoneinfo/"$(cat /etc/timezone.alpine-builder)" /data/etc/localtime
  fi

  # check host name
  if [ ! -f /data/etc/hostname ]; then
    cp /etc/hostname.alpine-builder /data/etc/hostname
  fi

  # check root password (shadow)
  if [ ! -f /data/etc/shadow ]; then
    cp /etc/shadow.alpine-builder /data/etc/shadow
  fi

  # check network config
  if [ ! -f /data/etc/network/interfaces ]; then
    mkdir -p /data/etc/network
    cp /etc/network/interfaces.alpine-builder /data/etc/network/interfaces
  fi

  # dropbear
  if [ ! -f /data/etc/dropbear/dropbear.conf ]; then
    mkdir -p /data/etc/dropbear/
    cp /etc/conf.d/dropbear_org /data/etc/dropbear/dropbear.conf
  fi

  if [ ! -d /data/root ]; then
    mkdir -p /data/root
  fi

  # swap
  if [ ! -f /data/swapfile ]; then
    fallocate -l 256M /data/swapfile
    mkswap /data/swapfile
    chmod 600 /data/swapfile
    swapon /data/swapfile
  fi

  eend 0
}
