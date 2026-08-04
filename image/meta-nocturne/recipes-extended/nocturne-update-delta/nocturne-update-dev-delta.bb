SUMMARY = "Nocturne dev-image delta OTA (.swu, zchunk)"

SUPERBIRD_OTA_SW_DESCRIPTION_VARIANT = "delta"

require recipes-core/superbird-bsp-update/superbird-bsp-update.inc
require recipes-extended/nocturne-update/nocturne-update-signing.inc

SWU_VERSION = "${DISTRO_VERSION}-dev+${NOCTURNE_BUILD_ID}"

SUPERBIRD_OTA_SOURCE_IMAGE = "nocturne-dev-image"
SUPERBIRD_OTA_BOOT_ARTIFACT = "boot.vfat.zck.zckheader"
SUPERBIRD_OTA_BOOT_CPIO_NAME = "boot.vfat.zck.zckheader"
SUPERBIRD_OTA_SYSTEM_ARTIFACT  = "${SUPERBIRD_OTA_SOURCE_LINKNAME}.squashfs-lz4.zck.zckheader"
SUPERBIRD_OTA_SYSTEM_CPIO_NAME = "system.img.zck.zckheader"

do_render_sw_description:append() {
    sed -i \
        -e 's|chunks from url over http|chunks from nocturned over local IPC|' \
        -e 's|only the changed chunks cross the wire|only the changed chunks cross Bluetooth|' \
        "${UNPACKDIR}/sw-description"
}
