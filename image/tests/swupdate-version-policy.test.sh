#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
POLICY=${SCRIPT_DIR}/../meta-nocturne/recipes-extended/swupdate-config/files/20-nocturne-version-policy
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

printf '%s\n' '4.2.0+20260725192801' > "$TEST_ROOT/installed"
RESULT=$(
  NOCTURNE_INSTALLED_VERSION_FILE=$TEST_ROOT/installed \
    /bin/sh -c 'SWUPDATE_ARGS=-v; . "$1"; printf "%s\n" "$SWUPDATE_ARGS"' sh "$POLICY"
)
test "$RESULT" = '-v --no-downgrading 4.2.0+20260725192801 --no-reinstalling 4.2.0+20260725192801'

printf '%s\n' '4.2.0 invalid' > "$TEST_ROOT/invalid"
RESULT=$(
  NOCTURNE_INSTALLED_VERSION_FILE=$TEST_ROOT/invalid \
    /bin/sh -c 'SWUPDATE_ARGS=-v; . "$1"; printf "%s\n" "$SWUPDATE_ARGS"' sh "$POLICY"
)
test "$RESULT" = '-v'

grep -q 'NOCTURNE_INSTALLED_VERSION_FILE:-/etc/nocturne/floor-version' "$POLICY"
if grep -q '/var/lib/bandaid' "$POLICY"; then
  echo "native image policy must not read the bandaid version marker" >&2
  exit 1
fi

echo "swupdate version policy tests passed"
