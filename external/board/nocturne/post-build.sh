#!/usr/bin/env bash
set -ex

TARGET_DIR="$1"

sed -i "s|\${GIT_HASH}|$(git -C .. rev-parse HEAD)|g" "$TARGET_DIR"/etc/nocturne/version.json
sed -i "s|\${BUILD_DATE}|$(date +%Y-%m-%d-%H-%M-%S)|g" "$TARGET_DIR"/etc/nocturne/version.json

rm -rf "$TARGET_DIR"/etc/dropbear
ln -s /var/local/etc/dropbear "$TARGET_DIR"/etc/dropbear
