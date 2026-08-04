SUMMARY = "Nocturne dev-image full OTA (.swu)"

require recipes-core/superbird-bsp-update/superbird-bsp-update.inc
require nocturne-update-signing.inc

SWU_VERSION = "${DISTRO_VERSION}-dev+${NOCTURNE_BUILD_ID}"

SUPERBIRD_OTA_SOURCE_IMAGE = "nocturne-dev-image"
SUPERBIRD_OTA_BOOT_ARTIFACT = "boot.vfat.zst"
SUPERBIRD_OTA_SYSTEM_ARTIFACT  = "${SUPERBIRD_OTA_SOURCE_LINKNAME}.squashfs-lz4.zst"
SUPERBIRD_OTA_SYSTEM_CPIO_NAME = "system.img"
