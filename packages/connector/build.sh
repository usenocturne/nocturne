#!/usr/bin/env bash
set -e

# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
# Image build config
# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
: "${CONNECTOR_IMAGE_VERSION:="v2.0.0"}"

: "${ALPINE_BUILD:="3.23"}"
: "${ALPINE_BUILD_PATCH:="4"}"

: "${BUN_VERSION:="1.3.13"}"

# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
# System config
# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
: "${DEFAULT_HOSTNAME:="nocturne-connector"}"
: "${DEFAULT_ROOT_PASSWORD:="nocturne"}"

: "${SYSINIT_SERVICES:="devfs dmesg hwdrivers"}"
: "${BOOT_SERVICES:="sysctl hostname localmount bootmisc modules"}"
: "${DEFAULT_SERVICES:=""}"
: "${SHUTDOWN_SERVICES:="killprocs"}"

: "${SIZE_BOOT:="100M"}"
: "${SIZE_ROOT:="512M"}"

: "${STAGES:="00 10 20 30 40"}"

# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
# Static config
# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
REQUIRED_CMDS=(curl zip unzip genimage mkpasswd m4 rsync pigz)
for cmd in "${REQUIRED_CMDS[@]}"; do
  if ! command -v "$cmd" > /dev/null 2>&1; then
    echo "$cmd is required to run this script."
    exit 1
  fi
done

SAVED_PWD="$(pwd)"

WORK_PATH=$(mktemp -d)
export BOOTFS_PATH="${WORK_PATH}/bootfs"
export ROOTFS_PATH="${WORK_PATH}/rootfs"
export OUTPUT_PATH="${SAVED_PWD}/output"
export CACHE_PATH="${SAVED_PWD}/cache"
export IMAGE_PATH="${WORK_PATH}/image"

export CONNECTOR_PATH="${SAVED_PWD}/src"
export SCRIPTS_PATH="${SAVED_PWD}/scripts"
export HELPERS_PATH="${SAVED_PWD}/scripts/build-helpers"
export RES_PATH="${SAVED_PWD}/resources"
DEF_STAGE_PATH="${SAVED_PWD}/scripts/stages"

mkdir -p "$BOOTFS_PATH" "$ROOTFS_PATH" "$OUTPUT_PATH" "$CACHE_PATH" "$IMAGE_PATH"

# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
# Functions
# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
make_image() {
  [ -d /tmp/genimage ] && rm -rf /tmp/genimage
  genimage --rootpath "$1" \
    --tmppath /tmp/genimage \
    --inputpath "$IMAGE_PATH" \
    --outputpath "$IMAGE_PATH" \
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

for _stage in ${STAGES}; do
  run_stage_scripts "$_stage"
done

color_echo ">> Finished <<"
