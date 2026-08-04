#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
SYNC_SCRIPT=${SCRIPT_DIR}/../meta-nocturne/recipes-core/nocturne-floor-sync/files/nocturne-floor-sync
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

prepare_case() {
  CASE_ROOT=$TEST_ROOT/$1
  mkdir -p "$CASE_ROOT/root/daemon" "$CASE_ROOT/root/webapps/ui"
  mkdir -p "$CASE_ROOT/bandaid/daemon" "$CASE_ROOT/bandaid/webapps/ui"
  printf 'root-daemon\n' > "$CASE_ROOT/root/daemon/nocturned.current"
  chmod 0755 "$CASE_ROOT/root/daemon/nocturned.current"
  printf 'root-ui\n' > "$CASE_ROOT/root/webapps/ui/index.html"
  printf 'old-daemon\n' > "$CASE_ROOT/bandaid/daemon/nocturned.current"
  chmod 0755 "$CASE_ROOT/bandaid/daemon/nocturned.current"
  printf 'old-ui\n' > "$CASE_ROOT/bandaid/webapps/ui/index.html"
  printf '%s\n' "$2" > "$CASE_ROOT/root-version"
  printf '%s\n' "$3" > "$CASE_ROOT/bandaid/.floor-version"
}

run_case() {
  NOCTURNE_ROOTFS_FLOOR_DIR=$CASE_ROOT/root \
    NOCTURNE_BANDAID_DIR=$CASE_ROOT/bandaid \
    NOCTURNE_FLOOR_VERSION_FILE=$CASE_ROOT/root-version \
    /bin/sh "$SYNC_SCRIPT"
}

prepare_case preserve-newer-overlay 4.1.0 4.2.0
run_case
test "$(cat "$CASE_ROOT/bandaid/.floor-version")" = 4.2.0
test "$(cat "$CASE_ROOT/bandaid/daemon/nocturned.current")" = old-daemon
test "$(cat "$CASE_ROOT/bandaid/webapps/ui/index.html")" = old-ui

prepare_case replace-older-overlay 4.2.0 4.1.9
run_case
test "$(cat "$CASE_ROOT/bandaid/.floor-version")" = 4.2.0
test "$(cat "$CASE_ROOT/bandaid/daemon/nocturned.current")" = root-daemon
test "$(cat "$CASE_ROOT/bandaid/webapps/ui/index.html")" = root-ui

prepare_case release-beats-prerelease 4.2.0 4.2.0-rc.1
run_case
test "$(cat "$CASE_ROOT/bandaid/.floor-version")" = 4.2.0

prepare_case build-metadata-does-not-downgrade 4.2.0 4.2.0+hot.5
run_case
test "$(cat "$CASE_ROOT/bandaid/.floor-version")" = 4.2.0+hot.5
test "$(cat "$CASE_ROOT/bandaid/daemon/nocturned.current")" = old-daemon

prepare_case newer-root-build-replaces-overlay 4.2.0+20260725192801 4.2.0+20260725192800
run_case
test "$(cat "$CASE_ROOT/bandaid/.floor-version")" = 4.2.0+20260725192801
test "$(cat "$CASE_ROOT/bandaid/daemon/nocturned.current")" = root-daemon

prepare_case newer-hot-build-survives-reboot 4.2.0+20260725192800 4.2.0+20260725192801
run_case
test "$(cat "$CASE_ROOT/bandaid/.floor-version")" = 4.2.0+20260725192801
test "$(cat "$CASE_ROOT/bandaid/daemon/nocturned.current")" = old-daemon

prepare_case invalid-root-version is-not-semver 4.2.0
if run_case; then
  echo "invalid root version was accepted" >&2
  exit 1
fi
test "$(cat "$CASE_ROOT/bandaid/.floor-version")" = 4.2.0
test "$(cat "$CASE_ROOT/bandaid/daemon/nocturned.current")" = old-daemon

echo "nocturne-floor-sync tests passed"
