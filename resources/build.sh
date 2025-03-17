#!/bin/sh
set -e

# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
# User config
# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
: "${ALPINE_BRANCH:="v3.21"}"
: "${ALPINE_MIRROR:="https://dl-cdn.alpinelinux.org/alpine"}"

: "${DEFAULT_TIMEZONE:="Etc/UTC"}"
: "${DEFAULT_HOSTNAME:="nocturne"}"
: "${DEFAULT_ROOT_PASSWORD:="nocturne"}"
: "${DEFAULT_DROPBEAR_ENABLED:="true"}"
: "${DEFAULT_SERVICES:="hostname local modules networking ntpd syslog"}"
: "${SYSINIT_SERVICES:="rngd"}"
: "${BOOT_SERVICES:="swap"}"
: "${ARCH:="aarch64"}"

: "${SIZE_ROOT_FS:="1280M"}"
: "${SIZE_DATA:="990M"}"

: "${OUTPUT_PATH:="/output"}"
: "${CACHE_PATH:="/cache"}"

: "${STAGES:="00 10 20 30 40 50"}"

ALPINE_BRANCH=$(echo "$ALPINE_BRANCH" | sed '/^[0-9]/s/^/v/')

# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
# static config
# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
WORK_PATH="/work"
IMAGE_PATH="${WORK_PATH}/img"
export RES_PATH=/resources/
DEF_STAGE_PATH="${RES_PATH}/scripts/stages"
export ROOTFS_PATH="${WORK_PATH}/root_fs"
export DATAFS_PATH="${WORK_PATH}/data_fs"

# console colours (default Green)
# shellcheck disable=SC2034
Red='-Red'
# shellcheck disable=SC2034
Yellow='-Yellow'
# shellcheck disable=SC2034
Blue='-Blue'
#Purple='-Purple'
Cyan='-Cyan'
#White='-White'

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

# run stage scripts
run_stage_scripts() {
  for S in "${DEF_STAGE_PATH}/$1"/*.sh; do
    _sname=$(basename "$S")
    [ "$_sname" = "*.sh" ] && break
    [ "$_sname" = "00-echo.sh" ] || color_echo "  Stage $1 - Running $_sname" "$Cyan"
    # shellcheck disable=SC1090
    . "$S"
  done
}

# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
# Stage 00 - Prepare root FS
# Stage 10 - Configure root FS
# Stage 20 - Configure system
# Stage 30 - Nocturne configuration
# Stage 40 - Cleanup
# Stage 50 - Create images
# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #

for _stage in ${STAGES}; do
  run_stage_scripts "$_stage"
done
color_echo ">> Finished <<"
