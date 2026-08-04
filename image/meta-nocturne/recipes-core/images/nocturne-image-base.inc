inherit core-image
inherit superbird-headroom-check
inherit superbird-image
inherit mainline-flashthing

MAINLINE_FLASHTHING_WITH_BANDAID = "1"
MAINLINE_FLASHTHING_BANDAID_RECIPE = "nocturne-bandaid"

require nocturne-chromium-slim.inc

IMAGE_FEATURES += "ssh-server-openssh post-install-logging"

IMAGE_INSTALL = " \
    packagegroup-core-boot \
    packagegroup-nocturne-core \
"

BAD_RECOMMENDATIONS += "kernel-modules udev-hwdb wpa-supplicant wireless-regdb wireless-regdb-static weston-init"

SUPERBIRD_ROOTFS_TYPE ??= "ext4"
EXTRA_IMAGECMD:squashfs-lz4 = "-b 1M -no-xattrs -all-root -Xhc"
EXTRA_IMAGECMD:ext4 = "-i 16384 -m 0 -O ^has_journal -O ^huge_file"
ZSTD_DEFAULTS = "-19 -T0"

IMAGE_FSTYPES = "wic ${SUPERBIRD_ROOTFS_TYPE} ${SUPERBIRD_ROOTFS_TYPE}.zst ${SUPERBIRD_ROOTFS_TYPE}.zck ${SUPERBIRD_ROOTFS_TYPE}.zck.zckheader"
IMAGE_CLASSES += "image_types_zchunk"

SUPERBIRD_WKS_ROOTFS_MKFS_EXTRAOPTS ??= "${@'-F -i 16384 -m 0 -O ^has_journal -O ^huge_file' if (d.getVar('SUPERBIRD_WKS_ROOTFS_FSTYPE') or '') == 'ext4' else ''}"
WKS_FILE = "nocturne-mainline.wks.in"

do_image_wic[depends] += " \
    virtual/kernel:do_deploy \
    superbird-uenv:do_deploy \
    superbird-extlinux:do_deploy \
    superbird-logo:do_deploy \
"

EXTRA_IMAGEDEPENDS += "superbird-uboot nocturne-bandaid"

NOCTURNE_CHANNEL ?= "stable"
NOCTURNE_IMAGE_VARIANT ?= "prod"
NOCTURNE_IMAGE_VERSION ?= "${DISTRO_VERSION}+${NOCTURNE_BUILD_ID}"

nocturne_meta_postprocess() {
    META=${IMAGE_ROOTFS}${datadir}/superbird/meta.json.in
    if [ ! -f "$META" ]; then
        return
    fi
    awk -v c="${NOCTURNE_CHANNEL}" -v v="${NOCTURNE_IMAGE_VARIANT}" -v ver="${NOCTURNE_IMAGE_VERSION}" '
        /^}$/ {
            print "  \"channel\": \"" c "\","
            print "  \"imageVariant\": \"" v "\","
            print "  \"imageVersion\": \"" ver "\""
            print
            next
        }
        /^  "imageBuildDate":/ {
            sub(/$/, ",")
            print
            next
        }
        { print }
    ' "$META" > "$META.tmp" && mv "$META.tmp" "$META"
}

nocturne_floor_version_postprocess() {
    VERSION_DIR="${IMAGE_ROOTFS}${sysconfdir}/nocturne"
    install -d "$VERSION_DIR"
    echo "${NOCTURNE_IMAGE_VERSION}" > "$VERSION_DIR/floor-version"
}

_NOCTURNE_META_VARDEPS = " \
    NOCTURNE_CHANNEL \
    NOCTURNE_IMAGE_VARIANT \
    NOCTURNE_IMAGE_VERSION \
"
nocturne_meta_postprocess[vardeps] += "${_NOCTURNE_META_VARDEPS}"
IMAGE_PREPROCESS_COMMAND[vardeps] += "${_NOCTURNE_META_VARDEPS}"
do_image[vardeps] += "${_NOCTURNE_META_VARDEPS}"
IMAGE_PREPROCESS_COMMAND:append = " nocturne_meta_postprocess; nocturne_floor_version_postprocess; "
