SUMMARY = "Nocturne prod-image full OTA (.swu)"

require recipes-core/superbird-bsp-update/superbird-bsp-update.inc

SUPERBIRD_OTA_SOURCE_IMAGE = "nocturne-prod-image"
SUPERBIRD_OTA_SYSTEM_ARTIFACT  = "${SUPERBIRD_OTA_SOURCE_LINKNAME}.ext4"
SUPERBIRD_OTA_SYSTEM_CPIO_NAME = "system.img"
