#!/bin/sh

rm -rf "$OUTPUT_PATH:?"/*
cp "$IMAGE_PATH"/boot.bin "$RES_PATH"/flash/env.txt "$RES_PATH"/flash/meta.json "$OUTPUT_PATH"/
cp "$IMAGE_PATH"/system.ext4 "$IMAGE_PATH"/data.ext4 "$OUTPUT_PATH"/

pigz -c "$IMAGE_PATH"/system.ext4 > "$OUTPUT_PATH"/nocturne_update.img.gz

cd "$OUTPUT_PATH"/ || exit 1
sha256sum nocturne_update.img.gz > nocturne_update.img.gz.sha256
