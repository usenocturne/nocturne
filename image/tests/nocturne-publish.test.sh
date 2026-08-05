#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=${SCRIPT_DIR}/..
PUBLISH=${REPO_ROOT}/scripts/nocturne-publish
RELEASE=${REPO_ROOT}/scripts/nocturne-release
FULL_DESCRIPTION=${REPO_ROOT}/meta-nocturne/recipes-extended/nocturne-update/files/full/sw-description
DELTA_DESCRIPTION=${REPO_ROOT}/meta-nocturne/recipes-extended/nocturne-update/files/delta/sw-description
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

VERSION=9.8.7+20260725000100
DEPLOY=${TEST_ROOT}/deploy
FULL=${TEST_ROOT}/full
DELTA=${TEST_ROOT}/delta
mkdir -p "$DEPLOY" "$FULL" "$DELTA"

sha256() {
  python3 - "$1" << 'PY'
import hashlib
import pathlib
import sys

print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())
PY
}

printf 'boot-full\n' > "${FULL}/boot.vfat"
printf 'system-full\n' > "${FULL}/system.img"
FULL_BOOT_HASH=$(sha256 "${FULL}/boot.vfat")
FULL_SYSTEM_HASH=$(sha256 "${FULL}/system.img")
sed \
  -e "s|@@VERSION@@|${VERSION}|g" \
  -e "s|\$swupdate_get_sha256(boot.vfat)|${FULL_BOOT_HASH}|g" \
  -e "s|\$swupdate_get_sha256(system.img)|${FULL_SYSTEM_HASH}|g" \
  "$FULL_DESCRIPTION" > "${FULL}/sw-description"
(
  cd "$FULL"
  bsdtar --format=cpio -cf "${DEPLOY}/nocturne-update-prod-superbird.swu" \
    sw-description boot.vfat system.img
)

printf 'boot-header\n' > "${DELTA}/boot.vfat.zck.zckheader"
printf 'system-header\n' > "${DELTA}/system.img.zck.zckheader"
DELTA_BOOT_HASH=$(sha256 "${DELTA}/boot.vfat.zck.zckheader")
DELTA_SYSTEM_HASH=$(sha256 "${DELTA}/system.img.zck.zckheader")
sed \
  -e "s|@@VERSION@@|${VERSION}|g" \
  -e 's|@@DELTA_URL_BASE@@|nocturne:/|g' \
  -e "s|\$swupdate_get_sha256(boot.vfat.zck.zckheader)|${DELTA_BOOT_HASH}|g" \
  -e "s|\$swupdate_get_sha256(system.img.zck.zckheader)|${DELTA_SYSTEM_HASH}|g" \
  "$DELTA_DESCRIPTION" > "${DELTA}/sw-description"
(
  cd "$DELTA"
  bsdtar --format=cpio -cf "${DEPLOY}/nocturne-update-prod-delta-superbird.swu" \
    sw-description boot.vfat.zck.zckheader system.img.zck.zckheader
)

printf 'boot-zchunk\n' > "${DEPLOY}/boot.vfat.zck"
printf 'system-zchunk\n' > "${DEPLOY}/nocturne-prod-image-superbird.ext4.zck"
mkdir -p "${TEST_ROOT}/stage/${VERSION}/bandaid"
printf 'preserve sibling release\n' > "${TEST_ROOT}/stage/${VERSION}/bandaid/manifest.json"

NOCTURNE_DEPLOY_DIR=$DEPLOY \
  NOCTURNE_OTA_IMAGES_DIR=${TEST_ROOT}/published \
  NOCTURNE_PUBLISH_STAGE=${TEST_ROOT}/stage \
  NOCTURNE_RELEASE_VERSION=$VERSION \
  NOCTURNE_DELTA_FROM_VERSIONS=9.8.6+20260724000100 \
  NOCTURNE_SWUPDATE_SIGNING_MODE=development-unsigned \
  "$PUBLISH" prod > /dev/null

python3 - "${TEST_ROOT}/published/${VERSION}/image/manifest.json" << 'PY'
import json
import pathlib
import sys

manifest = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert manifest["packages"]["full"]["assets"][0]["name"] == "nocturne-update-prod-superbird.swu"
assert manifest["packages"]["delta"]["assets"][0]["name"] == "nocturne-update-prod-delta-superbird.swu"
assert manifest["packages"]["delta"]["from_versions"] == ["9.8.6+20260724000100"]
PY

test -f "${TEST_ROOT}/stage/${VERSION}/image/manifest.json"
test -f "${TEST_ROOT}/stage/${VERSION}/image/assets/nocturne-update-prod-superbird.swu"
test -f "${TEST_ROOT}/stage/${VERSION}/image/assets/nocturne-update-prod-delta-superbird.swu"
test -f "${TEST_ROOT}/stage/${VERSION}/image/assets/boot.vfat.zck"
test -f "${TEST_ROOT}/stage/${VERSION}/image/assets/system.img.zck"
test ! -e "${TEST_ROOT}/stage/manifest.json"
test ! -e "${TEST_ROOT}/stage/assets"
grep -q 'preserve sibling release' "${TEST_ROOT}/stage/${VERSION}/bandaid/manifest.json"

NOCTURNE_DEPLOY_DIR=$DEPLOY \
  NOCTURNE_OTA_IMAGES_DIR=${TEST_ROOT}/compat-published \
  NOCTURNE_PUBLISH_STAGE=${TEST_ROOT}/compat-stage \
  NOCTURNE_DELTA_FROM_VERSIONS=9.8.6+20260724000100 \
  NOCTURNE_SWUPDATE_SIGNING_MODE=development-unsigned \
  "$RELEASE" prod > /dev/null

test -f "${TEST_ROOT}/compat-published/${VERSION}/image/manifest.json"

if NOCTURNE_DEPLOY_DIR=$DEPLOY \
  NOCTURNE_OTA_IMAGES_DIR=${TEST_ROOT}/published \
  NOCTURNE_PUBLISH_STAGE=${TEST_ROOT}/collision-stage \
  NOCTURNE_RELEASE_VERSION=$VERSION \
  NOCTURNE_DELTA_FROM_VERSIONS='*' \
  NOCTURNE_SWUPDATE_SIGNING_MODE=development-unsigned \
  "$PUBLISH" prod > "${TEST_ROOT}/collision.log" 2>&1; then
  echo "publisher overwrote an existing image release" >&2
  exit 1
fi
grep -q 'image release already exists' "${TEST_ROOT}/collision.log"

printf 'tampered\n' > "${FULL}/system.img"
(
  cd "$FULL"
  bsdtar --format=cpio -cf "${DEPLOY}/nocturne-update-prod-superbird.swu" \
    sw-description boot.vfat system.img
)

if NOCTURNE_DEPLOY_DIR=$DEPLOY \
  NOCTURNE_OTA_IMAGES_DIR=${TEST_ROOT}/rejected \
  NOCTURNE_PUBLISH_STAGE=${TEST_ROOT}/rejected-stage \
  NOCTURNE_RELEASE_VERSION=$VERSION \
  NOCTURNE_DELTA_FROM_VERSIONS='*' \
  NOCTURNE_SWUPDATE_SIGNING_MODE=development-unsigned \
  "$PUBLISH" prod > "${TEST_ROOT}/rejected.log" 2>&1; then
  echo "publisher accepted a payload whose bytes do not match sw-description" >&2
  exit 1
fi
grep -q 'wrong authenticated hash for system.img' "${TEST_ROOT}/rejected.log"

if NOCTURNE_DEPLOY_DIR=$DEPLOY \
  NOCTURNE_OTA_IMAGES_DIR=${TEST_ROOT}/invalid-version \
  NOCTURNE_PUBLISH_STAGE=${TEST_ROOT}/invalid-version-stage \
  NOCTURNE_RELEASE_VERSION=9.8.7+release.1 \
  NOCTURNE_DELTA_FROM_VERSIONS='*' \
  NOCTURNE_SWUPDATE_SIGNING_MODE=development-unsigned \
  "$PUBLISH" prod > "${TEST_ROOT}/invalid-version.log" 2>&1; then
  echo "publisher accepted nonnumeric image build metadata" >&2
  exit 1
fi
grep -q 'must include a 14-digit UTC build ID' "${TEST_ROOT}/invalid-version.log"

if NOCTURNE_DEPLOY_DIR=$DEPLOY \
  NOCTURNE_OTA_IMAGES_DIR=${TEST_ROOT}/invalid-delta \
  NOCTURNE_PUBLISH_STAGE=${TEST_ROOT}/invalid-delta-stage \
  NOCTURNE_RELEASE_VERSION=$VERSION \
  NOCTURNE_DELTA_FROM_VERSIONS=not-a-version \
  NOCTURNE_SWUPDATE_SIGNING_MODE=development-unsigned \
  "$PUBLISH" prod > "${TEST_ROOT}/invalid-delta.log" 2>&1; then
  echo "publisher accepted an invalid delta source version" >&2
  exit 1
fi
grep -q 'invalid delta source version' "${TEST_ROOT}/invalid-delta.log"

echo "Nocturne publisher tests passed"
