#!/usr/bin/env bash

# build debian image, intended to run on a debian 11 arm64 host
# expects an existing dump at ./dumps/debian_current/
#   ./dumps is ignored by git
# install_debian.sh expects kernel modules extracted from system_a.ext2 to already be at ./modules/
# also expects you to already have apt-cacher-ng installed on this local system

EXISTING_DUMP="./dumps/debian_current"
DATA_IMAGE="${EXISTING_DUMP}/data.ext4"

if [ ! -d "$EXISTING_DUMP" ]; then
    echo "Need an existing device dump at: $EXISTING_DUMP"
    exit 1
fi

if [ ! -f "$DATA_IMAGE" ]; then
    echo "Missing expected data.ext4: $DATA_IMAGE"
    exit 1
fi

sudo ./install_debian.sh "$DATA_IMAGE" --local_proxy

