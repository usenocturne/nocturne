#!/bin/sh

chroot_exec apk add caddy

github_releases -r usenocturne/nocturne-ui -a nocturne-ui -d /etc/nocturne/ui -v "$NOCTURNE_UI_TAG"

mkdir -p "$ROOTFS_PATH"/etc/caddy
cat > "$ROOTFS_PATH"/etc/caddy/Caddyfile << EOF
http://localhost:3000 {
  root * /etc/nocturne/ui
  encode
	file_server
}
EOF

DEFAULT_SERVICES="${DEFAULT_SERVICES} caddy"
