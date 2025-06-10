#!/bin/sh

# use -c to copy script/command to chroot before running it

if [ "$1" = "-c" ]; then
  shift
  install -t "$ROOTFS_PATH"/tmp "$1"
  COMMAND=/tmp/$(basename "$1")
  DEL="$ROOTFS_PATH$COMMAND"
else
  COMMAND="$1"
fi
shift

chroot "$ROOTFS_PATH" "$COMMAND" "$@" 1>&2
ret="$?"
[ -n "$DEL" ] && rm "$DEL"
exit "$ret"
