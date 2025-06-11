#!/bin/sh

rm "$OUTPUT_PATH"/* || true
cp "$IMAGE_PATH"/system.ext4 "$OUTPUT_PATH"/

#cd "$OUTPUT_PATH"/ || exit 1

#zip -r9 nocturne_image.zip .
