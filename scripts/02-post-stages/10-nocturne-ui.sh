#!/usr/bin/env bash

curl -L https://github.com/caddyserver/caddy/releases/download/v2.10.0/caddy_2.10.0_linux_armv7.tar.gz | tar -xz -C "$WORK_PATH" caddy
sudo install -Dm755 "$WORK_PATH"/caddy "$MNT_PATH"/usr/bin/caddy

curl -Lo "$WORK_PATH"/nocturne-ui.zip https://nightly.link/usenocturne/nocturne-ui/workflows/build/"$NOCTURNE_UI_TAG"/nocturne-ui.zip
sudo mkdir -p "$MNT_PATH"/etc/nocturne/ui
sudo unzip -o "$WORK_PATH"/nocturne-ui.zip -d "$MNT_PATH"/etc/nocturne/ui

sudo mkdir -p "$ROOTFS_PATH"/etc/caddy
