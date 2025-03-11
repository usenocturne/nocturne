#!/bin/sh

# update native repositories to ALPINE_MIRROR, leaving version the same
awk -v repo="$ALPINE_MIRROR" -F'/' '{print repo "\/" $(NF-1) "\/" $NF}' /etc/apk/repositories > /etc/apk/repositories.tmp
mv -f /etc/apk/repositories.tmp /etc/apk/repositories

# update new root repositories to ensure the right packages are installed
cat > "$ROOTFS_PATH"/etc/apk/repositories <<EOF
${ALPINE_MIRROR}/${ALPINE_BRANCH}/main
${ALPINE_MIRROR}/${ALPINE_BRANCH}/community
EOF
