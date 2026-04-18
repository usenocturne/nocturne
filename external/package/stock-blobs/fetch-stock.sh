#!/usr/bin/env bash
set -exuo pipefail

: "${FIRMWARE_ID:="P3QZbZIDWnp5m_azQFQqP"}"
: "${VERSION_ID:="Sn_vBLpPfJjic6DZtCj6k"}"
: "${FILE_ID:="IVXX0JDs_B5nDGs5Om0it"}"

WORK_PATH=$(mktemp -d)
MNT_PATH="$WORK_PATH/mnt"
EXTRACT_PATH="$WORK_PATH/extract"
BUILD_PATH="$WORK_PATH/build"
OUTPUT_PATH="$(pwd)/dl/stock-blobs"

cleanup() {
  if mountpoint -q "${MNT_PATH}"; then
    umount "${MNT_PATH}"
  fi
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

echo "Mounting system"
mkdir -p "${MNT_PATH}"
mount -o loop "${EXTRACT_PATH}/system_a.ext2" "${MNT_PATH}"

#

echo "Copying files"
rm "$BUILD_PATH"/* 2> /dev/null || true

(
  mkdir -p "$BUILD_PATH"
  cd "$BUILD_PATH" || exit 1
  mkdir -p lib/firmware usr/{bin,lib,libexec,share} usr/share/fonts etc
)

cp -a "$MNT_PATH"/lib/modules "$BUILD_PATH"/lib/

cp -a "$MNT_PATH"/lib/firmware/brcm "$BUILD_PATH"/lib/firmware

cp "$MNT_PATH"/usr/bin/{phb,uenv} "$BUILD_PATH"/usr/bin/
cp -a "$MNT_PATH"/usr/bin/chromium-browser "$BUILD_PATH"/usr/bin/
cp "$MNT_PATH"/usr/bin/swupdate* "$BUILD_PATH"/usr/bin/
cp "$MNT_PATH"/usr/bin/weston* "$BUILD_PATH"/usr/bin/

cp -a "$MNT_PATH"/usr/lib/{libweston-3,weston} "$BUILD_PATH"/usr/lib/

cp "$MNT_PATH"/usr/lib/libatomic.so.1.2.0 "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libcairo.so.2.11512.0 "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libconfig.so.11.0.2 "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libcrypto.so.1.1 "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libdrm.so.2.4.0 "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libevdev.so.2.2.0 "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libffi.so.7.1.0 "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libfontconfig.so.1.12.0 "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libfreetype.so.6.16.1 "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libinput.so.10.13.0 "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libjpeg.so.9.3.0 "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/liblua.so.5.3.5 "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libMali.so "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libmtdev.so.1.0.0 "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libnspr4.so "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libnss3.so "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libnssutil3.so "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libpixman-1.so.0.34.0 "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libplc4.so "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libplds4.so "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libpng16.so.16.36.0 "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libsmime3.so "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libsoftokn3.so "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libwayland-client.so.0.3.0 "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libwayland-cursor.so.0.0.0 "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libwayland-server.so.0.1.0 "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libwebp.so.7.0.3 "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libweston-3.so.0.0.0 "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libweston-desktop-3.so.0.0.0 "$BUILD_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libxkbcommon.so.0.0.0 "$BUILD_PATH"/usr/lib/

cp "$MNT_PATH"/usr/libexec/weston* "$BUILD_PATH"/usr/libexec/

cp -a "$MNT_PATH"/usr/share/{X11,fontconfig} "$BUILD_PATH"/usr/share/
cp -a "$MNT_PATH"/usr/share/fonts/ttf-bitstream-vera "$BUILD_PATH"/usr/share/fonts/

cp -a "$MNT_PATH"/etc/fonts "$BUILD_PATH"/etc/

chown -R root:root "$BUILD_PATH"/*

#

echo "Creating archive"
mkdir -p "$OUTPUT_PATH"
tar -czf "$OUTPUT_PATH/stock-blobs-8.9.2.tar.gz" -C "$BUILD_PATH" .
echo "Blobs ready at $OUTPUT_PATH/stock-blobs-8.9.2.tar.gz"
