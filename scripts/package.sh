#!/usr/bin/env bash
set -euo pipefail

: "${FIRMWARE_ID:="P3QZbZIDWnp5m_azQFQqP"}"
: "${VERSION_ID:="Sn_vBLpPfJjic6DZtCj6k"}"
: "${FILE_ID:="IVXX0JDs_B5nDGs5Om0it"}"

WORK_PATH=$(mktemp -d)
EXTRACT_PATH="$WORK_PATH/extract"
BUILD_PATH="$WORK_PATH/build"
OUTPUT_PATH="$(pwd)/output/package"

cleanup() {
  rm -rf "${WORK_PATH}"
}
trap cleanup EXIT

########################

FIRMWARE_URL="https://thingify.tools/files/blob/${FIRMWARE_ID}/${VERSION_ID}/${FILE_ID}?name=8.9.2-thinglabs.zip"
FIRMWARE_BASENAME="8.9.2-thinglabs.zip"
FIRMWARE_FILE="${WORK_PATH}/${FIRMWARE_BASENAME}"

echo "Downloading ${FIRMWARE_URL}"
curl -Lo "$FIRMWARE_FILE" "$FIRMWARE_URL"

echo "Unzipping firmware"
rm "$EXTRACT_PATH"/* 2> /dev/null || true
mkdir -p "${EXTRACT_PATH}"
unzip -q "${FIRMWARE_FILE}" -d "${EXTRACT_PATH}"

echo "Copying files"
rm "$BUILD_PATH"/* 2> /dev/null || true
mkdir -p "$BUILD_PATH"
cp -a "$EXTRACT_PATH"/* "$BUILD_PATH"

(
    cd "$BUILD_PATH"
    rm -f system_a.ext2 system_b.ext2 env.txt env.dump logo.dump
)

cp output/images/rootfs.ext2 "$BUILD_PATH"/system_a.ext2
cp output/images/rootfs.ext2 "$BUILD_PATH"/system_b.ext2
cp resources/env.txt "$BUILD_PATH"/env.txt
cp resources/logo.dump "$BUILD_PATH"/logo.dump

echo "Creating zip"
(
    cd "$BUILD_PATH"
    rm "$OUTPUT_PATH"/* 2> /dev/null || true
    mkdir -p "$OUTPUT_PATH"
    zip -r "$OUTPUT_PATH"/nocturne.zip .
)

echo "Done"
