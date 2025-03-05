#!/bin/sh
# shellcheck disable=SC2002
if ! ret=$(cat /proc/cmdline | tr ' ' '\n' | grep "$1="); then
  exit 1
fi

echo "$ret" | cut -d'=' -f2
