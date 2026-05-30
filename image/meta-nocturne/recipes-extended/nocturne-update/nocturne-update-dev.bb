SUMMARY = "Nocturne dev-image full OTA (.swu)"

require recipes-core/superbird-bsp-update/superbird-bsp-update.inc

SUPERBIRD_OTA_SOURCE_IMAGE = "nocturne-dev-image"
SUPERBIRD_OTA_SYSTEM_ARTIFACT  = "${SUPERBIRD_OTA_SOURCE_LINKNAME}.squashfs-lz4"
SUPERBIRD_OTA_SYSTEM_CPIO_NAME = "system.img"
