SUMMARY = "Nocturne development image"
DESCRIPTION = "Iteration image: weston desktop-shell with panel + VNC, dev tools, verbose daemon logging."
LICENSE = "MIT"

SUPERBIRD_ROOTFS_TYPE = "squashfs-lz4"

require nocturne-image-base.inc

IMAGE_FEATURES += "tools-debug post-install-logging"

IMAGE_INSTALL:append = " \
    packagegroup-nocturne-dev \
"

NOCTURNE_CHANNEL = "dev"
NOCTURNE_IMAGE_VARIANT = "dev"
NOCTURNE_IMAGE_VERSION = "${DISTRO_VERSION}-dev+${NOCTURNE_BUILD_ID}"
