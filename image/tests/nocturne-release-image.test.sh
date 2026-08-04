#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
RELEASE=${SCRIPT_DIR}/../scripts/nocturne-release-image
DISTRO_CONFIG=${SCRIPT_DIR}/../meta-nocturne/conf/distro/nocturne.conf
VERSION_CORE=$(sed -n 's/^DISTRO_VERSION[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$DISTRO_CONFIG")
MISMATCH_VERSION=99.99.99
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

test -n "$VERSION_CORE"
test "$VERSION_CORE" != "$MISMATCH_VERSION"

mkdir -p "$TEST_ROOT/bin"
printf 'test-key\n' > "$TEST_ROOT/nocturne.pem"
cat > "$TEST_ROOT/bin/just" << 'SH'
#!/bin/sh
set -eu
printf '%s|%s|%s|%s|%s|%s\n' \
  "${NOCTURNE_BUILD_ID:-}" \
  "${NOCTURNE_SWUPDATE_SIGNING_MODE:-}" \
  "${NOCTURNE_SWUPDATE_PRIVATE_KEY:-}" \
  "${NOCTURNE_RELEASE_VERSION:-}" \
  "${NOCTURNE_DELTA_FROM_VERSIONS:-}" \
  "$*" >> "$NOCTURNE_RELEASE_IMAGE_TEST_LOG"
SH
chmod +x "$TEST_ROOT/bin/just"
cat > "$TEST_ROOT/bin/date" << 'SH'
#!/bin/sh
set -eu
test "$*" = '-u +%Y%m%d%H%M%S'
printf '%s\n' 20260727150000
SH
chmod +x "$TEST_ROOT/bin/date"

NOCTURNE_RELEASE_IMAGE_TEST_LOG=$TEST_ROOT/calls \
  PATH="$TEST_ROOT/bin:$PATH" \
  "$RELEASE" \
  "$VERSION_CORE" \
  "$TEST_ROOT/nocturne.pem" > /dev/null

sed -n '1p' "$TEST_ROOT/calls" | grep -F \
  "20260727150000|production|$TEST_ROOT/nocturne.pem|||" > /dev/null
sed -n '1p' "$TEST_ROOT/calls" | grep -F ' build nocturne-local' > /dev/null
sed -n '2p' "$TEST_ROOT/calls" | grep -F \
  "|production||${VERSION_CORE}+20260727150000|*|" > /dev/null
sed -n '2p' "$TEST_ROOT/calls" | grep -F ' publish prod' > /dev/null
test "$(wc -l < "$TEST_ROOT/calls" | tr -d ' ')" = 2

NOCTURNE_RELEASE_IMAGE_TEST_LOG=$TEST_ROOT/dev-calls \
  PATH="$TEST_ROOT/bin:$PATH" \
  "$RELEASE" \
  "$VERSION_CORE" \
  "$TEST_ROOT/nocturne.pem" \
  '*' \
  dev \
  nocturne > /dev/null
sed -n '1p' "$TEST_ROOT/dev-calls" | grep -F ' build nocturne' > /dev/null
sed -n '2p' "$TEST_ROOT/dev-calls" | grep -F \
  "|production||${VERSION_CORE}-dev+20260727150000|*|" > /dev/null
sed -n '2p' "$TEST_ROOT/dev-calls" | grep -F ' publish dev' > /dev/null

if NOCTURNE_RELEASE_IMAGE_TEST_LOG=$TEST_ROOT/rejected \
  PATH="$TEST_ROOT/bin:$PATH" \
  "$RELEASE" \
  "$MISMATCH_VERSION" \
  "$TEST_ROOT/nocturne.pem" > /dev/null 2>&1; then
  echo "release wrapper accepted a version that does not match DISTRO_VERSION" >&2
  exit 1
fi
test ! -e "$TEST_ROOT/rejected"

for invalid_core in 4.1 "${VERSION_CORE}-dev" "${VERSION_CORE}+20260727150000"; do
  if NOCTURNE_RELEASE_IMAGE_TEST_LOG=$TEST_ROOT/invalid-core \
    PATH="$TEST_ROOT/bin:$PATH" \
    "$RELEASE" \
    "$invalid_core" \
    "$TEST_ROOT/nocturne.pem" > /dev/null 2>&1; then
    echo "release wrapper accepted invalid version core: $invalid_core" >&2
    exit 1
  fi
  test ! -e "$TEST_ROOT/invalid-core"
done

if NOCTURNE_RELEASE_IMAGE_TEST_LOG=$TEST_ROOT/mixed-wildcard \
  PATH="$TEST_ROOT/bin:$PATH" \
  "$RELEASE" \
  "$VERSION_CORE" \
  "$TEST_ROOT/nocturne.pem" \
  '*,4.0.0+20260726150000' > /dev/null 2>&1; then
  echo "release wrapper accepted '*' mixed with an explicit delta source" >&2
  exit 1
fi
test ! -e "$TEST_ROOT/mixed-wildcard"

if NOCTURNE_RELEASE_IMAGE_TEST_LOG=$TEST_ROOT/invalid-target \
  PATH="$TEST_ROOT/bin:$PATH" \
  "$RELEASE" \
  "$VERSION_CORE" \
  "$TEST_ROOT/nocturne.pem" \
  '*' \
  prod \
  unsupported > /dev/null 2>&1; then
  echo "release wrapper accepted an unsupported image target" >&2
  exit 1
fi
test ! -e "$TEST_ROOT/invalid-target"

NOCTURNE_BUILD_ID=20260727150001 \
  NOCTURNE_RELEASE_IMAGE_TEST_LOG=$TEST_ROOT/reproduced \
  PATH="$TEST_ROOT/bin:$PATH" \
  "$RELEASE" \
  "$VERSION_CORE" \
  "$TEST_ROOT/nocturne.pem" > /dev/null
sed -n '1p' "$TEST_ROOT/reproduced" | grep -F \
  "20260727150001|production|$TEST_ROOT/nocturne.pem|||" > /dev/null
sed -n '2p' "$TEST_ROOT/reproduced" | grep -F \
  "|production||${VERSION_CORE}+20260727150001|*|" > /dev/null

echo "Nocturne image release tests passed"
