SUMMARY = "Nocturne production image"
DESCRIPTION = "ext4 ro rootfs with chromium kiosk (cast_shell), weston kiosk-shell, Panfrost driving the Mali-G31."
LICENSE = "MIT"

require nocturne-image-base.inc

IMAGE_OVERHEAD_FACTOR = "1.0"

# set_image_size derives ROOTFS_SIZE from the rootfs's apparent size, which can
# exceed the fixed A/B slot even when mkfs can pack the contents into it. Force
# the standalone OTA filesystem to the slot size and verify it before image
# conversions run.
NOCTURNE_PROD_ROOTFS_SIZE_KIB = "${@int(d.getVar('SUPERBIRD_ROOT_PART_SIZE')) * 1024}"
NOCTURNE_PROD_ROOTFS_SIZE_BYTES = "${@int(d.getVar('SUPERBIRD_ROOT_PART_SIZE')) * 1024 * 1024}"

nocturne_assert_prod_ext4_size() {
    image="${IMGDEPLOYDIR}/${IMAGE_NAME}.ext4"
    if [ ! -f "$image" ]; then
        bbfatal "Production ext4 was not created at $image"
    fi

    actual_size=$(stat -c '%s' "$image")
    if [ "$actual_size" -ne "${NOCTURNE_PROD_ROOTFS_SIZE_BYTES}" ]; then
        bbfatal "Production ext4 is $actual_size bytes; expected ${NOCTURNE_PROD_ROOTFS_SIZE_BYTES} bytes for the ${SUPERBIRD_ROOT_PART_SIZE} MiB A/B slot"
    fi
}

IMAGE_CMD:ext4:prepend = "ROOTFS_SIZE=${NOCTURNE_PROD_ROOTFS_SIZE_KIB}; "
IMAGE_CMD:ext4:append = "; nocturne_assert_prod_ext4_size"

IMAGE_INSTALL:append = " \
    superbird-weston-init-kiosk \
"

BAD_RECOMMENDATIONS += "adwaita-icon-theme-symbolic"

NOCTURNE_IMAGE_VARIANT = "prod"
