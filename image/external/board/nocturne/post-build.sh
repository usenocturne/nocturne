#!/usr/bin/env bash
set -ex

TARGET_DIR="$1"

git_hash=$(git -C .. rev-parse HEAD)
build_date=$(date +%Y-%m-%d-%H-%M-%S)

sed -i "s|\${GIT_HASH}|${git_hash}|g" "$TARGET_DIR"/etc/nocturne/version.json
sed -i "s|\${BUILD_DATE}|${build_date}|g" "$TARGET_DIR"/etc/nocturne/version.json

version=$(cat "$TARGET_DIR"/etc/nocturne/version.json | jq -r '.shortVersion')

sed -i "s|\${VERSION}|${version}|g" "$TARGET_DIR"/etc/motd
sed -i "s|\${GIT_HASH}|${git_hash}|g" "$TARGET_DIR"/etc/motd

sed -i "s|\${NOCTURNE_VERSION}|${version}|g" "$TARGET_DIR"/etc/fastfetch/config.jsonc
