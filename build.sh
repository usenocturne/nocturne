#!/usr/bin/env bash
set -e

# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
# Image build config
# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
: "${NOCTURNE_IMAGE_VERSION:="v3.0.0-beta5"}"

: "${NOCTURNE_UI_TAG:="main"}"
: "${NOCTURNED_TAG:="v1.0.13"}"
: "${WINGMAN_TAG:="v1.0.1"}"

: "${VOID_BUILD:="20250202"}"
: "${STATIC_WEB_SERVER_VERSION:="v2.37.0"}"

# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
# System config
# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
: "${DEFAULT_HOSTNAME:="nocturne"}"
: "${DEFAULT_ROOT_PASSWORD:="nocturne"}"
: "${DEFAULT_SERVICES:=""}"

: "${SIZE_ROOT_FS:="516M"}"

: "${STAGES:="00 10 20 30 40"}"

# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
# Static config
# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
REQUIRED_CMDS=(curl zip unzip genimage m4 xbps-install mkpasswd execstack)
for cmd in "${REQUIRED_CMDS[@]}"; do
  if ! command -v "$cmd" > /dev/null 2>&1; then
    echo "$cmd is required to run this script."
    exit 1
  fi
done

SAVED_PWD="$(pwd)"

WORK_PATH=$(mktemp -d)
export ROOTFS_PATH="${WORK_PATH}/rootfs"
export UPDATE_PATH="${WORK_PATH}/update"
IMAGE_PATH="${WORK_PATH}/img"
export OUTPUT_PATH="${SAVED_PWD}/output"
export CACHE_PATH="${SAVED_PWD}/cache"

export SCRIPTS_PATH="${SAVED_PWD}/scripts"
export HELPERS_PATH="${SAVED_PWD}/scripts/build-helpers"
export M4_PATH="${SAVED_PWD}/m4"
export RES_PATH="${SAVED_PWD}/resources"
DEF_STAGE_PATH="${SAVED_PWD}/scripts/stages"

mkdir -p "$IMAGE_PATH" "$ROOTFS_PATH" "$OUTPUT_PATH" "$CACHE_PATH" "$UPDATE_PATH"

export XBPS_ARCH="armv7l"

# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
# Functions
# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
make_image() {
  [ -d /tmp/genimage ] && rm -rf /tmp/genimage
  genimage --rootpath "$1" \
    --tmppath /tmp/genimage \
    --inputpath "${IMAGE_PATH}" \
    --outputpath "${IMAGE_PATH}" \
    --config "$2"
}

color_echo() {
  ColourOff='\033[0m'
  Prefix='\033[0;'
  Index=31
  Colours_Name="Red Green Yellow Blue Purple Cyan White"
  COLOUR="Green"
  Text=""

  while [ $# -gt 0 ]; do
    if echo "$1" | grep -q "^-"; then
      COLOUR="${1#-}"
    else
      Text="$1"
    fi
    shift
  done

  for col in ${Colours_Name}; do
    [ "$col" = "$COLOUR" ] && break
    Index=$((Index + 1))
  done

  printf "%b\n" "${Prefix}${Index}m${Text}${ColourOff}"
}

run_stage_scripts() {
  for S in "${DEF_STAGE_PATH}/$1"/*.sh; do
    _sname=$(basename "$S")
    [ "$_sname" = "*.sh" ] && break
    [ "$_sname" = "00-echo.sh" ] || color_echo "  Stage $1 - Running $_sname" -Cyan
    # shellcheck disable=SC1090
    . "$S"
  done
}

# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
# Stage 00 - Prepare root FS
# Stage 10 - Configure system
# Stage 20 - Nocturne configuration
# Stage 30 - Cleanup
# Stage 40 - Create images
# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #

if [ ! -d "$RES_PATH"/stock-files/output ]; then
  color_echo "Please run 'cd resources/stock-files && ./download.sh' first." -Red
  exit 1
fi

for _stage in ${STAGES}; do
  run_stage_scripts "$_stage"
done
color_echo ">> Finished <<"
