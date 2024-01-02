#!/usr/bin/env bash

# create a distributable tar.gz from ./dumps/debian_current with given version number (without v) and today's date

# all config lives in image_config.sh
source ./image_config.sh

DATESTAMP=$(date -I)
VERSION="$1"

if [ -z "$VERSION" ]; then
    echo "Need to provide version: ./create_release.sh 1.1"
    exit 1
fi

RELEASE_NAME="debian_v${VERSION}_${DATESTAMP}"
ARCHIVE_NAME="${RELEASE_NAME}.tar.gz"

if [ -e "./dist/$ARCHIVE_NAME" ]; then
    echo "dist package already exists! ./dist/$ARCHIVE_NAME"
    exit 1
fi


mkdir -p ./dumps
mv "$EXISTING_DUMP" "./dumps/$RELEASE_NAME"

pushd ./dumps || exit 1

tar czvf "../dist/$ARCHIVE_NAME" "./$RELEASE_NAME"

popd || exit 1

mv "./dumps/$RELEASE_NAME" "$EXISTING_DUMP"

echo "Created ./dist/$ARCHIVE_NAME"
