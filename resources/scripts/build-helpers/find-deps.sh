#!/bin/sh

# check it is not a directory or empty
[ -z "$1" ] && echo "No module to find deps for" && exit 1
echo "$1" | grep -q "\.ko" || exit 0

SAVE="/tmp/modules.save"
MOD="$(echo "$1" | sed "s/.\///")"
echo "  > $MOD"
grep "^$MOD" ./modules.dep | sed "s/://" >>"$SAVE"
