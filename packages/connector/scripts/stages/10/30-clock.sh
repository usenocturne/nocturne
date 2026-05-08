#!/bin/sh

mkdir -p "$ROOTFS_PATH"/var/lib/misc
touch "$ROOTFS_PATH"/var/lib/misc/openrc-shutdowntime

mkdir -p "$ROOTFS_PATH"/etc/crontabs
cat > "$ROOTFS_PATH"/etc/crontabs/root <<'EOF'
*/15 * * * * /usr/libexec/rc/sbin/swclock --save /var/lib/misc/openrc-shutdowntime
EOF
chmod 600 "$ROOTFS_PATH"/etc/crontabs/root

BOOT_SERVICES="${BOOT_SERVICES} swclock"
DEFAULT_SERVICES="${DEFAULT_SERVICES} crond"
