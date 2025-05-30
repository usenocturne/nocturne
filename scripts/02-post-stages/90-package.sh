#!/usr/bin/env bash

sudo umount "${MNT_PATH}"

rm -f "${EXTRACT_PATH}/system_b.ext2"
cp "${EXTRACT_PATH}/system_a.ext2" "${EXTRACT_PATH}/system_b.ext2"

rm "$OUTPUT_PATH"/* 2> /dev/null || true
mkdir -p "$OUTPUT_PATH"

cd "${EXTRACT_PATH}" || exit 1
zip -r9 "${OUTPUT_PATH}/nocturne-image.zip" ./*
