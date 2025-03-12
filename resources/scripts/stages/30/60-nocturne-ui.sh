#!/bin/sh

chroot_exec apk add caddy

curl -LO https://nightly.link/usenocturne/nocturne-ui/workflows/build/vite/nocturne-ui.zip
mkdir -p "$ROOTFS_PATH"/etc/nocturne/ui
unzip nocturne-ui.zip -d "$ROOTFS_PATH"/etc/nocturne/ui

mkdir -p "$ROOTFS_PATH"/etc/caddy
cat > "$ROOTFS_PATH"/etc/caddy/Caddyfile <<EOF
https://localhost:3000 {
  root * /etc/nocturne/ui
  encode
	file_server
}
EOF

DEFAULT_SERVICES="${DEFAULT_SERVICES} caddy"
