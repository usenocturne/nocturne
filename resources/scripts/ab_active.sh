#!/bin/sh
set -e

current_idx=$(ab_bootparam root | grep -Eo '[0-9]+$')

if [ "$current_idx" -eq 5 ]; then
  echo "Active partition: A"
else
  echo "Active partition: B"
fi
