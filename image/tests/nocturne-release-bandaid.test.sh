#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
RELEASE=${SCRIPT_DIR}/../scripts/nocturne-release-bandaid
REPO_ROOT=$(CDPATH='' cd -- "${SCRIPT_DIR}/../.." && pwd)
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

VERSION_CORE=4.2.0
BUILD_ID=20260804150000
VERSION=${VERSION_CORE}+${BUILD_ID}
MINIMUM_IMAGE_VERSION=4.1.0+20260803150000
EXPORT_ROOT=${TEST_ROOT}/export
IMAGES_ROOT=${TEST_ROOT}/images

mkdir -p "$TEST_ROOT/bin" "$EXPORT_ROOT/$VERSION/image"
printf 'preserve image sibling\n' > "$EXPORT_ROOT/$VERSION/image/manifest.json"

cat > "$TEST_ROOT/bin/just" << 'SH'
#!/bin/sh
set -eu

case "${1:-}" in
  daemon-build | ui-build)
    exit 0
    ;;
esac

test "${1:-}" = -f
case "${3:-}" in
  package-bandaid)
    mkdir -p "$6"
    printf 'bandaid payload\n' > "$6/nocturne-bandaid.tar.zst"
    ;;
  publish-component)
    test "$4" = bandaid
    bun "$NOCTURNE_RELEASE_BANDAID_REPO_ROOT/nocturne-ota/scripts/publish-yocto-version.ts" \
      --source "$6" \
      --version "$5" \
      --channel "$8" \
      --kind "$4" \
      --minimum-image-version "$7" \
      --images-root "$NOCTURNE_OTA_IMAGES_DIR"
    ;;
  *)
    echo "unexpected just call: $*" >&2
    exit 1
    ;;
esac
SH
chmod +x "$TEST_ROOT/bin/just"

NOCTURNE_BUILD_ID=$BUILD_ID \
  NOCTURNE_PUBLISH_STAGE=$EXPORT_ROOT \
  NOCTURNE_OTA_IMAGES_DIR=$IMAGES_ROOT \
  NOCTURNE_RELEASE_BANDAID_REPO_ROOT=$REPO_ROOT \
  PATH="$TEST_ROOT/bin:$PATH" \
  "$RELEASE" "$VERSION_CORE" "$MINIMUM_IMAGE_VERSION" stable > /dev/null

test -f "$EXPORT_ROOT/$VERSION/bandaid/manifest.json"
test -f "$EXPORT_ROOT/$VERSION/bandaid/assets/nocturne-bandaid.tar.zst"
test ! -e "$IMAGES_ROOT"
grep -q 'preserve image sibling' "$EXPORT_ROOT/$VERSION/image/manifest.json"

if NOCTURNE_BUILD_ID=$BUILD_ID \
  NOCTURNE_PUBLISH_STAGE=$EXPORT_ROOT \
  NOCTURNE_OTA_IMAGES_DIR=$IMAGES_ROOT \
  NOCTURNE_RELEASE_BANDAID_REPO_ROOT=$REPO_ROOT \
  PATH="$TEST_ROOT/bin:$PATH" \
  "$RELEASE" "$VERSION_CORE" "$MINIMUM_IMAGE_VERSION" stable > "$TEST_ROOT/collision.log" 2>&1; then
  echo "bandaid release overwrote an existing export" >&2
  exit 1
fi
grep -q 'bandaid release already exists' "$TEST_ROOT/collision.log"

echo "Nocturne bandaid release tests passed"
