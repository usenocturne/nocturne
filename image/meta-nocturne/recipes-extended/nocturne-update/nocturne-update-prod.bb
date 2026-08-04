SUMMARY = "Nocturne prod-image full OTA (.swu)"

require recipes-core/superbird-bsp-update/superbird-bsp-update.inc
require nocturne-update-signing.inc

SWU_VERSION = "${DISTRO_VERSION}+${NOCTURNE_BUILD_ID}"

SUPERBIRD_OTA_SOURCE_IMAGE = "nocturne-prod-image"
SUPERBIRD_OTA_BOOT_ARTIFACT = "boot.vfat.zst"
SUPERBIRD_OTA_SYSTEM_ARTIFACT  = "${SUPERBIRD_OTA_SOURCE_LINKNAME}.ext4.zst"
SUPERBIRD_OTA_SYSTEM_CPIO_NAME = "system.img"
