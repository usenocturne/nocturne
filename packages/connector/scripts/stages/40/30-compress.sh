#!/bin/sh

IMG_NAME="nocturne-connector_${CONNECTOR_IMAGE_VERSION}"

rm -f "$OUTPUT_PATH"/"$IMG_NAME".img.gz "$OUTPUT_PATH"/"$IMG_NAME".img.gz.sha256
pigz -c "$IMAGE_PATH"/sdcard.img > "$OUTPUT_PATH"/"$IMG_NAME".img.gz

cd "$OUTPUT_PATH" || exit 1
sha256sum "$IMG_NAME".img.gz > "$IMG_NAME".img.gz.sha256
