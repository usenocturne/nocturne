#!/bin/sh

rm "$OUTPUT_PATH"/* || true
cp "$IMAGE_PATH"/boot.bin "$RES_PATH"/flash/env.txt "$RES_PATH"/flash/meta.json "$OUTPUT_PATH"/
cp "$IMAGE_PATH"/system.ext4 "$IMAGE_PATH"/data.ext4 "$OUTPUT_PATH"/

cd "$OUTPUT_PATH"/ || exit 1

zip -r9 nocturne_image.zip .
sha256sum nocturne_image.zip > nocturne_image.zip.sha256

cp "$RES_PATH"/flash/README.txt "$RES_PATH"/flash/flash.bat "$RES_PATH"/flash/flash.sh "$OUTPUT_PATH"/
zip -r9 nocturne_installer.zip README.txt flash.bat flash.sh nocturne_image.zip nocturne_image.zip.sha256

pigz -c "$IMAGE_PATH"/system.ext4 > "$OUTPUT_PATH"/nocturne_update.img.gz
sha256sum nocturne_update.img.gz > nocturne_update.img.gz.sha256
