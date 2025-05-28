#!/usr/bin/env bash

(
  cd "$MNT_PATH" || exit 1
  sudo rm -f etc/coredhcp/* etc/init.d/S49usbgadget etc/supervisord.conf
)
