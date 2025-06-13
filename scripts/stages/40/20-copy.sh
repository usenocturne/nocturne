#!/bin/sh

rm "$OUTPUT_PATH"/* 2> /dev/null || true

mv "$IMAGE_PATH"/system.ext4 "$IMAGE_PATH"/system_a.ext2
cp "$IMAGE_PATH"/system_a.ext2 "$IMAGE_PATH"/system_b.ext2

cd "$RES_PATH"/stock-files/extract/ || exit 1
cp boot_a.dump boot_b.dump bootloader.dump dtbo_a.dump dtbo_b.dump fip_a.dump fip_b.dump misc.dump vbmeta_a.dump vbmeta_b.dump "$IMAGE_PATH"/
cp "$RES_PATH"/flash/env.txt "$RES_PATH"/flash/logo.dump "$IMAGE_PATH"/

cd "$IMAGE_PATH"/ || exit 1
zip -r9 "$OUTPUT_PATH"/nocturne_image.zip .
