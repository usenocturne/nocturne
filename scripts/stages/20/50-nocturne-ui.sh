#!/bin/sh

#xbps-install -r "$ROOTFS_PATH" -y caddy

curl -Lo "$WORK_PATH"/nocturne-ui.zip https://nightly.link/usenocturne/nocturne-ui/workflows/build/"$NOCTURNE_UI_TAG"/nocturne-ui.zip
mkdir -p "$ROOTFS_PATH"/etc/nocturne/ui
unzip "$WORK_PATH"/nocturne-ui.zip -d "$ROOTFS_PATH"/etc/nocturne/ui

mkdir -p "$ROOTFS_PATH"/etc/caddy
cat > "$ROOTFS_PATH"/etc/caddy/Caddyfile << EOF
http://localhost:3000 {
  root * /etc/nocturne/ui
  encode
	file_server
}
EOF

#DEFAULT_SERVICES="${DEFAULT_SERVICES} caddy"
