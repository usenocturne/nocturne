#!/usr/bin/env bash
set -e
set -x

: "${FIRMWARE_ID:="P3QZbZIDWnp5m_azQFQqP"}"
: "${VERSION_ID:="Sn_vBLpPfJjic6DZtCj6k"}"
: "${FILE_ID:="IVXX0JDs_B5nDGs5Om0it"}"

WORK_PATH=$(mktemp -d)
MNT_PATH="$WORK_PATH/mnt"
EXTRACT_PATH="$WORK_PATH/extract"
OUTPUT_PATH="$(pwd)/output"

cleanup() {
  if mountpoint -q "${MNT_PATH}"; then
    sudo umount "${MNT_PATH}"
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
mkdir -p "${EXTRACT_PATH}"
unzip -q "${FIRMWARE_FILE}" -d "${EXTRACT_PATH}"

echo "Mounting system"
mkdir -p "${MNT_PATH}"
sudo mount -o loop "${EXTRACT_PATH}/system_a.ext2" "${MNT_PATH}"

#

echo "Copying files"
rm "$OUTPUT_PATH"/* 2> /dev/null || true

(
  mkdir -p "$OUTPUT_PATH"
  cd "$OUTPUT_PATH" || exit 1
  mkdir -p lib bin usr/{bin,lib,libexec,share}
)

cp -a "$MNT_PATH"/lib/modules "$OUTPUT_PATH"/lib/

cp "$MNT_PATH"/usr/bin/{phb,uenv} "$OUTPUT_PATH"/usr/bin/
cp -a "$MNT_PATH"/usr/bin/chromium-browser "$OUTPUT_PATH"/usr/bin/
cp "$MNT_PATH"/usr/bin/weston* "$OUTPUT_PATH"/usr/bin/

cp -a "$MNT_PATH"/usr/lib/{libweston-3,weston} "$OUTPUT_PATH"/usr/lib/

cp "$MNT_PATH"/usr/lib/libasound.so.2.0.0 "$OUTPUT_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libatomic.so.1.2.0 "$OUTPUT_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libcairo.so.2.11512.0 "$OUTPUT_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libdrm.so.2.4.0 "$OUTPUT_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libevdev.so.2.2.0 "$OUTPUT_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libfontconfig.so.1.12.0 "$OUTPUT_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libfreetype.so.6.16.1 "$OUTPUT_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libinput.so.10.13.0 "$OUTPUT_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libjpeg.so.9.3.0 "$OUTPUT_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libMali.so "$OUTPUT_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libmtdev.so.1.0.0 "$OUTPUT_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libnspr4.so "$OUTPUT_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libnss3.so "$OUTPUT_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libnssutil3.so "$OUTPUT_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libpixman-1.so.0.34.0 "$OUTPUT_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libplc4.so "$OUTPUT_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libplds4.so "$OUTPUT_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libpng16.so.16.36.0 "$OUTPUT_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libsmime3.so "$OUTPUT_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libsoftokn3.so "$OUTPUT_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libwayland-client.so.0.3.0 "$OUTPUT_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libwayland-cursor.so.0.0.0 "$OUTPUT_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libwayland-server.so.0.1.0 "$OUTPUT_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libwebp.so.7.0.3 "$OUTPUT_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libweston-3.so.0.0.0 "$OUTPUT_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libweston-desktop-3.so.0.0.0 "$OUTPUT_PATH"/usr/lib/
cp "$MNT_PATH"/usr/lib/libxkbcommon.so.0.0.0 "$OUTPUT_PATH"/usr/lib/

cp "$MNT_PATH"/usr/libexec/weston* "$OUTPUT_PATH"/usr/libexec/

cp -a "$MNT_PATH"/usr/share/X11 "$OUTPUT_PATH"/usr/share/

echo "Done!"
