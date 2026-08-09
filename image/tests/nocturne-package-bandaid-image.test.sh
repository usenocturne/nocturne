#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
PACKAGER=${SCRIPT_DIR}/../scripts/nocturne-package-bandaid-image
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

VERSION=4.2.0+20260804150000
PAYLOAD_DIR=$TEST_ROOT/payload
SOURCE_DIR=$TEST_ROOT/source
OUTPUT=$TEST_ROOT/output/bandaid.ext4
MKFS_LOG=$TEST_ROOT/mkfs-called

mkdir -p "$TEST_ROOT/bin" "$PAYLOAD_DIR" "$SOURCE_DIR/daemon" "$SOURCE_DIR/webapps/ui"
printf 'daemon\n' > "$SOURCE_DIR/daemon/nocturned.current"
chmod 0755 "$SOURCE_DIR/daemon/nocturned.current"
printf '<html></html>\n' > "$SOURCE_DIR/webapps/ui/index.html"
COPYFILE_DISABLE=1 tar -C "$SOURCE_DIR" -cf - . | zstd -q -o "$PAYLOAD_DIR/nocturne-bandaid.tar.zst"

cat > "$TEST_ROOT/bin/mkfs.ext4" << 'SH'
#!/bin/sh
set -eu

test "$1" = -t
test "$2" = ext4
test "$3" = -F
test "$4" = -L
test "$5" = bandaid
test "$6" = -m
test "$7" = 0
test "$8" = -O
test "$9" = '^has_journal'
test "${10}" = -d
STAGE=${11}
OUTPUT=${12}

test -f "$STAGE/nocturne/daemon/nocturned.current"
test -f "$STAGE/nocturne/webapps/ui/index.html"
test "$(cat "$STAGE/nocturne/.floor-version")" = "$NOCTURNE_TEST_VERSION"
test "$(wc -c <"$OUTPUT" | tr -d '[:space:]')" = 201326592
printf 'called\n' >"$NOCTURNE_TEST_MKFS_LOG"
SH
chmod +x "$TEST_ROOT/bin/mkfs.ext4"

NOCTURNE_MKFS_EXT4=$TEST_ROOT/bin/mkfs.ext4 \
  NOCTURNE_TEST_VERSION=$VERSION \
  NOCTURNE_TEST_MKFS_LOG=$MKFS_LOG \
  "$PACKAGER" "$PAYLOAD_DIR" "$VERSION" "$OUTPUT" > /dev/null

test -f "$MKFS_LOG"
test -f "$OUTPUT"
test "$(wc -c < "$OUTPUT" | tr -d '[:space:]')" = 201326592

if NOCTURNE_MKFS_EXT4=$TEST_ROOT/bin/mkfs.ext4 \
  NOCTURNE_TEST_VERSION=$VERSION \
  NOCTURNE_TEST_MKFS_LOG=$MKFS_LOG \
  "$PACKAGER" "$PAYLOAD_DIR" "$VERSION" "$OUTPUT" > "$TEST_ROOT/collision.log" 2>&1; then
  echo "bandaid image packager overwrote an existing output" >&2
  exit 1
fi
grep -q 'bandaid image already exists' "$TEST_ROOT/collision.log"

if NOCTURNE_MKFS_EXT4=$TEST_ROOT/bin/mkfs.ext4 \
  NOCTURNE_TEST_VERSION=not-semver \
  NOCTURNE_TEST_MKFS_LOG=$MKFS_LOG \
  "$PACKAGER" "$PAYLOAD_DIR" not-semver "$TEST_ROOT/invalid.ext4" > "$TEST_ROOT/invalid.log" 2>&1; then
  echo "bandaid image packager accepted an invalid release version" >&2
  exit 1
fi
grep -q 'Invalid bandaid release version' "$TEST_ROOT/invalid.log"
test ! -e "$TEST_ROOT/invalid.ext4"

echo "Nocturne bandaid image packaging tests passed"
