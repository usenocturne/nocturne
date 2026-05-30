SUMMARY = "Nocturne production image"
DESCRIPTION = "ext4 ro rootfs with chromium kiosk (cast_shell), weston kiosk-shell, Panfrost driving the Mali-G31."
LICENSE = "MIT"

require nocturne-image-base.inc

IMAGE_OVERHEAD_FACTOR = "1.0"
IMAGE_ROOTFS_EXTRA_SPACE = "4096"

IMAGE_INSTALL:append = " \
    superbird-weston-init-kiosk \
"

BAD_RECOMMENDATIONS += "adwaita-icon-theme-symbolic"

NOCTURNE_IMAGE_VARIANT = "prod"
