#!/bin/sh

curl -Lo "$WORK_PATH"/static-web-server.tar.gz https://github.com/static-web-server/static-web-server/releases/download/"$STATIC_WEB_SERVER_VERSION"/static-web-server-"$STATIC_WEB_SERVER_VERSION"-armv7-unknown-linux-musleabihf.tar.gz
tar -xvf "$WORK_PATH"/static-web-server.tar.gz --strip-components=1 --wildcards '*/static-web-server'
mv static-web-server "$ROOTFS_PATH"/usr/bin/static-web-server
chmod +x "$ROOTFS_PATH"/usr/bin/static-web-server
cp -a "$SCRIPTS_PATH"/services/nocturne-ui "$ROOTFS_PATH"/etc/sv/

curl -Lo "$WORK_PATH"/nocturne-ui.zip https://nightly.link/usenocturne/nocturne-ui/workflows/build/"$NOCTURNE_UI_TAG"/nocturne-ui.zip
mkdir -p "$ROOTFS_PATH"/etc/nocturne/ui
unzip "$WORK_PATH"/nocturne-ui.zip -d "$ROOTFS_PATH"/etc/nocturne/ui

DEFAULT_SERVICES="${DEFAULT_SERVICES} nocturne-ui"
