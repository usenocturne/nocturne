#!/bin/sh

curl -LO https://nightly.link/usenocturne/nocturne-ui/workflows/build/vite/nocturne-ui.zip

mkdir -p "$ROOTFS_PATH"/etc/nocturne/ui
unzip nocturne-ui.zip -d "$ROOTFS_PATH"/etc/nocturne/ui

chroot_exec apk add caddy
chroot_exec rc-update add caddy default

mkdir -p "$ROOTFS_PATH"/etc/caddy
cat > "$ROOTFS_PATH"/etc/caddy/Caddyfile <<EOF
https://localhost:3000 {
  root * /etc/nocturne/ui
  encode
	file_server
}
EOF
