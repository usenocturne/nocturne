SUMMARY = "Nocturne prod-image delta OTA (.swu, zchunk)"

SUPERBIRD_OTA_SW_DESCRIPTION_VARIANT = "delta"

require recipes-core/superbird-bsp-update/superbird-bsp-update.inc

SUPERBIRD_OTA_SOURCE_IMAGE = "nocturne-prod-image"
SUPERBIRD_OTA_SYSTEM_ARTIFACT  = "${SUPERBIRD_OTA_SOURCE_LINKNAME}.ext4.zck.zckheader"
SUPERBIRD_OTA_SYSTEM_CPIO_NAME = "system.img.zck.zckheader"
