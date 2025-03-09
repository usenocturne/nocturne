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
: "${DEFAULT_KERNEL_MODULES:="*"}"
: "${DEFAULT_SERVICES:="hostname local modules networking ntpd syslog"}"
: "${SYSINIT_SERVICES:="rngd"}"
: "${ARCH:="aarch64"}"
: "${DEV:="mdev"}"

: "${SIZE_ROOT_FS:="1536M"}"
: "${SIZE_DATA:="480M"}"

: "${OUTPUT_PATH:="/output"}"
: "${INPUT_PATH:="/input"}"
: "${CACHE_PATH:="/cache"}"

: "${STAGES:="00 10 20 30 40 50"}"

ALPINE_BRANCH=$(echo $ALPINE_BRANCH | sed '/^[0-9]/s/^/v/')

# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
# static config
# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
WORK_PATH="/work"
IMAGE_PATH="${WORK_PATH}/img"
export RES_PATH=/resources/
DEF_STAGE_PATH="${RES_PATH}/scripts/stages"
export INPUT_PATH
export ROOTFS_PATH="${WORK_PATH}/root_fs"
export DATAFS_PATH="${WORK_PATH}/data_fs"
SETUP_PREFIX="/data"

# console colours (default Green)
# shellcheck disable=SC2034
Red='-Red'
# shellcheck disable=SC2034
Yellow='-Yellow'
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
  _srun=""
  for S in "${DEF_STAGE_PATH}/$1"/*.sh; do
    _sname=$(basename "$S")
    [ "$_sname" = "*.sh" ] && break
    colour_echo "  Stage $1 Found $_sname" "$Cyan"
    if [ -f ${INPUT_PATH}/stages/"$1"/"$_sname" ]; then
      colour_echo "  Overriding $1 $_sname with user version" "$Blue"
      # shellcheck disable=SC1090
      . ${INPUT_PATH}/stages/"$1"/"$_sname"
      _srun="$_srun $_sname"
    else
      # shellcheck disable=SC1090
      . "$S"
    fi
  done
  # run remaining user stage scripts
  colour_echo "  Running user Stage $1 scripts" "$Cyan"
  for S in "${INPUT_PATH}/stages/$1"/*.sh; do
    _sname=$(basename "$S")
    [ "$_sname" = "*.sh" ] && break
    if ! echo "$_srun" | grep -q "$_sname"; then
      colour_echo "  Found $_sname" "$Cyan"
      # shellcheck disable=SC1090
      . "$S"
    fi
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
colour_echo ">> Finished <<"
