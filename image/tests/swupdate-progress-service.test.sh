#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
LAYER_ROOT=${SCRIPT_DIR}/../meta-nocturne
SERVICE=${LAYER_ROOT}/recipes-support/swupdate/files/swupdate-progress.service
BBAPPEND=${LAYER_ROOT}/recipes-support/swupdate/swupdate_%.bbappend

test "$(grep -c '^ExecStart=' "$SERVICE")" = 1
test "$(sed -n 's/^ExecStart=//p' "$SERVICE")" = '/usr/bin/swupdate-progress -w'
grep -Fq 'WantedBy=swupdate.service' "$SERVICE"
grep -Fq "FILESEXTRAPATHS:prepend := \"\${THISDIR}/files:\"" "$BBAPPEND"

if grep -Eq '(^|[[:space:]])(-r|--reboot)([[:space:]]|$)' "$SERVICE"; then
  echo "SWUpdate progress service must wait for an explicit user restart" >&2
  exit 1
fi

echo "swupdate progress service tests passed"
