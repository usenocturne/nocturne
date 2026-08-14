#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
RESET_SCRIPT=${SCRIPT_DIR}/../meta-nocturne/recipes-core/nocturne-daemon/files/nocturne-factory-reset
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

mkdir -p \
	"$TEST_ROOT/var/lib/bluetooth/adapter/peer" \
	"$TEST_ROOT/var/lib/chromium-kiosk/Local Storage" \
	"$TEST_ROOT/var/lib/nocturne/state" \
	"$TEST_ROOT/var/lib/nocturne/transfers" \
	"$TEST_ROOT/var/nocturne/webapps" \
	"$TEST_ROOT/var/lib/bandaid/nocturne" \
	"$TEST_ROOT/var/lib/superbird"
printf 'paired\n' >"$TEST_ROOT/var/lib/bluetooth/adapter/peer/info"
printf 'settings\n' >"$TEST_ROOT/var/lib/chromium-kiosk/Local Storage/settings"
printf 'state\n' >"$TEST_ROOT/var/lib/nocturne/state/state.db"
printf 'transfer\n' >"$TEST_ROOT/var/lib/nocturne/transfers/update"
printf 'webapp\n' >"$TEST_ROOT/var/nocturne/webapps/custom"
printf 'connector\n' >"$TEST_ROOT/var/lib/nocturne/known-macos-connectors.json"
printf 'ota\n' >"$TEST_ROOT/var/lib/nocturne/ota-current.json"
printf '4.1.2\n' >"$TEST_ROOT/var/lib/bandaid/nocturne/.floor-version"
printf 'identity\n' >"$TEST_ROOT/var/lib/superbird/meta.json"
touch "$TEST_ROOT/var/lib/nocturne/factory-reset.pending"

NOCTURNE_FACTORY_RESET_ROOT="$TEST_ROOT" /bin/sh "$RESET_SCRIPT"

test ! -e "$TEST_ROOT/var/lib/nocturne/factory-reset.pending"
test -z "$(find "$TEST_ROOT/var/lib/bluetooth" -mindepth 1 -maxdepth 1 -print -prune)"
test -z "$(find "$TEST_ROOT/var/lib/chromium-kiosk" -mindepth 1 -maxdepth 1 -print -prune)"
test -z "$(find "$TEST_ROOT/var/lib/nocturne/state" -mindepth 1 -maxdepth 1 -print -prune)"
test -z "$(find "$TEST_ROOT/var/lib/nocturne/transfers" -mindepth 1 -maxdepth 1 -print -prune)"
test -z "$(find "$TEST_ROOT/var/nocturne" -mindepth 1 -maxdepth 1 -print -prune)"
test ! -e "$TEST_ROOT/var/lib/nocturne/known-macos-connectors.json"
test ! -e "$TEST_ROOT/var/lib/nocturne/ota-current.json"
test "$(cat "$TEST_ROOT/var/lib/bandaid/nocturne/.floor-version")" = 4.1.2
test "$(cat "$TEST_ROOT/var/lib/superbird/meta.json")" = identity

echo "nocturne factory reset tests passed"
