#!/bin/sh

rm "$OUTPUT_PATH"/*
cp "$IMAGE_PATH"/boot.bin "$RES_PATH"/flash/env.txt "$RES_PATH"/flash/meta.json "$RES_PATH"/flash/README.txt "$OUTPUT_PATH"/
cp "$IMAGE_PATH"/system.ext4 "$IMAGE_PATH"/data.ext4 "$OUTPUT_PATH"/

cd "$OUTPUT_PATH"/ || exit 1

zip -r9 nocturne_installer.zip .
sha256sum nocturne_installer.zip > nocturne_installer.zip.sha256

pigz -c "$IMAGE_PATH"/system.ext4 > "$OUTPUT_PATH"/nocturne_update.img.gz
sha256sum nocturne_update.img.gz > nocturne_update.img.gz.sha256
