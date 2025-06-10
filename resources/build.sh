#!/bin/sh
set -e

# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
# Image build config
# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #

: "${NOCTURNE_IMAGE_VERSION:="v3.0.0-beta3"}"

: "${NOCTURNE_UI_TAG:="chrome-69"}"
: "${NOCTURNED_TAG:="v1.0.6"}"

# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
# User config
# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
: "${VOID_BUILD:="20250202"}"

: "${DEFAULT_TIMEZONE:="Etc/UTC"}"
: "${DEFAULT_HOSTNAME:="nocturne"}"
: "${DEFAULT_ROOT_PASSWORD:="nocturne"}"
: "${DEFAULT_SERVICES:=""}"

: "${SIZE_ROOT_FS:="516M"}"

: "${STAGES:="00 10 20 30 40 50"}"

# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
# static config
# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
WORK_PATH="/work"
IMAGE_PATH="${WORK_PATH}/img"
export RES_PATH=/resources/
DEF_STAGE_PATH="${RES_PATH}/scripts/stages"
export ROOTFS_PATH="${WORK_PATH}/root_fs"
export OUTPUT_PATH="/output"
export CACHE_PATH="/cache"

# ensure work directory is clean
rm -rf ${WORK_PATH:?}/*

# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
# functions
# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #

make_image() {
  [ -d /tmp/genimage ] && rm -rf /tmp/genimage
  genimage --rootpath "$1" \
    --tmppath /tmp/genimage \
    --inputpath ${IMAGE_PATH} \
    --outputpath ${IMAGE_PATH} \
    --config "$2"
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

exec /bin/sh
