#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
INSTALL=${SCRIPT_DIR}/../scripts/nocturne-install
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

mkdir -p "$TEST_ROOT/bin"
printf 'flash-image\n' > "$TEST_ROOT/image.zip"
SIZE=$(wc -c < "$TEST_ROOT/image.zip" | tr -d '[:space:]')
HASH=$(sha256sum "$TEST_ROOT/image.zip" | awk '{print $1}')

jq -n \
  --arg hash "$HASH" \
  --argjson size "$SIZE" \
  '{channels: {stable: {latest: "4.2.0"}, preview: {latest: "4.3.0"}}, releases: {"4.2.0": {download: {url: "https://example.test/stable.zip", size: $size, sha256: $hash}}, "4.3.0": {download: {url: "https://example.test/preview.zip", size: $size, sha256: $hash}}}}' \
  > "$TEST_ROOT/manifest.json"

cat > "$TEST_ROOT/bin/curl" << 'SH'
#!/bin/sh
set -eu
case "$1" in
  -fsSL)
    cat "$NOCTURNE_TEST_MANIFEST"
    ;;
  -fL)
    test "$2" = --output
    cp "$NOCTURNE_TEST_IMAGE" "$3"
    ;;
  *)
    echo "unexpected curl arguments: $*" >&2
    exit 1
    ;;
esac
SH

cat > "$TEST_ROOT/bin/flashthing" << 'SH'
#!/bin/sh
set -eu
cp "$1" "$NOCTURNE_TEST_FLASHED"
SH
chmod +x "$TEST_ROOT/bin/curl" "$TEST_ROOT/bin/flashthing"

NOCTURNE_TEST_MANIFEST="$TEST_ROOT/manifest.json" \
  NOCTURNE_TEST_IMAGE="$TEST_ROOT/image.zip" \
  NOCTURNE_TEST_FLASHED="$TEST_ROOT/flashed.zip" \
  PATH="$TEST_ROOT/bin:$PATH" \
  FLASHTHING_CLI=flashthing \
  OTA_PUBLIC_BASE=https://example.test \
  "$INSTALL" prod > /dev/null

cmp "$TEST_ROOT/image.zip" "$TEST_ROOT/flashed.zip"
echo "Nocturne install tests passed"
