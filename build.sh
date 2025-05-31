#!/usr/bin/env bash
set -e

# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
# Builder config
# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
: "${NOCTURNE_IMAGE_VERSION:="v3.0.0-beta3"}"

: "${NOCTURNE_UI_TAG:="chrome-69"}"
: "${NOCTURNED_TAG:="v1.0.6"}"

: "${FIRMWARE_ID:="P3QZbZIDWnp5m_azQFQqP"}"
: "${VERSION_ID:="Sn_vBLpPfJjic6DZtCj6k"}"
: "${FILE_ID:="IVXX0JDs_B5nDGs5Om0it"}"

: "${CADDY_VERSION:="2.10.0"}"

# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
# Static variables
# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
SAVED_PWD="$(pwd)"

WORK_PATH=$(mktemp -d)
MNT_PATH="${WORK_PATH}/mnt"
EXTRACT_PATH="${WORK_PATH}/extract"
export OUTPUT_PATH="${SAVED_PWD}/output"
CACHE_PATH="${SAVED_PWD}/cache"
export RES_PATH="${SAVED_PWD}/resources"

PRE_STAGES_PATH="${SAVED_PWD}/scripts/01-pre-stages"
POST_STAGES_PATH="${SAVED_PWD}/scripts/02-post-stages"

cleanup() {
    if mountpoint -q "${MNT_PATH}"; then
        sudo umount "${MNT_PATH}"
    fi
    rm -rf "${WORK_PATH}"
}
trap cleanup EXIT

# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
# Checks and functions
# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
REQUIRED_CMDS=(curl jq zip)
for cmd in "${REQUIRED_CMDS[@]}"; do
    if ! command -v "$cmd" > /dev/null 2>&1; then
        echo "$cmd is required to run this script."
        exit 1
    fi
done

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

run_stages() {
    local stage_path="$1"
    local stage_name="$2"
    color_echo ">> Run ${stage_name}-stages"
    for S in "${stage_path}"/*.sh; do
        _sname=$(basename "$S")
        [ "$_sname" = "*.sh" ] && break
        color_echo -Cyan "Running $_sname"
        # shellcheck disable=SC1090
        . "$S"
    done
}

cached_download() {
    local url="$1"
    local basename="$2"
    local output_file="$3"

    local cached_file="${CACHE_PATH}/${basename}"

    if [ -f "${cached_file}" ]; then
        echo "Using cached file: ${cached_file}"
        if ! cp "${cached_file}" "${output_file}"; then
            color_echo -Red "Failed to copy ${basename} from cache to ${output_file}."
            return 1
        fi
    else
        echo "Downloading ${url} to ${output_file}..."
        if curl -fSL -o "${output_file}" "${url}"; then
            if ! cp "${output_file}" "${cached_file}"; then
                color_echo -Red "Warning: Failed to cache ${basename}."
            fi
        else
            color_echo -Red "Failed to download ${url}"
            return 1
        fi
    fi

    return 0
}

# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
# Build
# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
color_echo ">> Prepare firmware"
FIRMWARE_URL="https://thingify.tools/files/blob/${FIRMWARE_ID}/${VERSION_ID}/${FILE_ID}?name=8.9.2-thinglabs.zip"
FIRMWARE_BASENAME="8.9.2-thinglabs.zip"
FIRMWARE_FILE="${WORK_PATH}/${FIRMWARE_BASENAME}"

mkdir -p "${CACHE_PATH}"

if ! cached_download "${FIRMWARE_URL}" "${FIRMWARE_BASENAME}" "${FIRMWARE_FILE}"; then
    color_echo -Red "Failed to download firmware."
    exit 1
fi

mkdir -p "${EXTRACT_PATH}"
unzip -q "${FIRMWARE_FILE}" -d "${EXTRACT_PATH}"

#
color_echo ">> Mount system"
mkdir -p "${MNT_PATH}"
sudo mount -o loop "${EXTRACT_PATH}/system_a.ext2" "${MNT_PATH}"

#
run_stages "${PRE_STAGES_PATH}" "pre"

#
color_echo ">> Apply overlay"
sudo rsync -aAXv overlay/ "${MNT_PATH}/"

#
run_stages "${POST_STAGES_PATH}" "post"

#
color_echo ">> Finished <<"
