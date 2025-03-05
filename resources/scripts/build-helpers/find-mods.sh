#!/bin/sh

# check it is not a directory or empty
[ -z "$1" ] && echo "No file to find mods in" && exit 1
[ ! -s "$1" ] && echo "$1 Does not exist" && exit 0
if ! basename "$1" | grep -q "modules"; then
  echo "$1" | grep -q "\.conf" || exit 0
fi
echo "  checking: $1"
SAVE="/tmp/modules.save"
MOD=$(grep -v '#' "$1" | xargs)
for M in ${MOD}; do
  echo "  > $M"
done

echo "$MOD" >>"$SAVE"
