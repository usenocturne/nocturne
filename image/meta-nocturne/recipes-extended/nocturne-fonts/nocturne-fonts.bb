SUMMARY = "Nocturne UI fonts (CircularSp, Inter, Noto subset)"
DESCRIPTION = "System fonts resolved by the Nocturne and Mockingbird kiosk UIs through fontconfig."
LICENSE = "MIT & OFL-1.1"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = " \
    file://CircularSp-Arab-Bold.ttf \
    file://CircularSp-Arab-Book.ttf \
    file://CircularSp-Cyrl-Bold.ttf \
    file://CircularSp-Cyrl-Book.ttf \
    file://CircularSp-Deva-Bold.ttf \
    file://CircularSp-Deva-Book.ttf \
    file://CircularSp-Grek-Bold.ttf \
    file://CircularSp-Grek-Book.ttf \
    file://CircularSp-Hebr-Bold.ttf \
    file://CircularSp-Hebr-Book.ttf \
    file://CircularSpUIv3T-Bold.ttf \
    file://CircularSpUIv3T-Book.ttf \
    file://Inter-Bold.ttf \
    file://Inter-Medium.ttf \
    file://Inter-Regular.ttf \
    file://Inter-SemiBold.ttf \
    file://NotoNaskhAR-VF.ttf \
    file://NotoSansBN-VF.ttf \
    file://NotoSansDV-VF.ttf \
    file://NotoSansGK-VF.ttf \
    file://NotoSansHE-VF.ttf \
    file://NotoSansSC-VF.ttf \
    file://NotoSansTA-VF.ttf \
    file://NotoSansTC-VF.ttf \
    file://NotoSansTH-VF.ttf \
    file://NotoSerifJP-VF.ttf \
    file://NotoSerifKR-VF.ttf \
    file://05-nocturne-ro-cachedir.conf \
    file://75-nocturne-circular.conf \
"
S = "${UNPACKDIR}"

inherit allarch fontcache

FONTS_DIR = "${datadir}/fonts/nocturne"

do_install() {
    install -d ${D}${FONTS_DIR}
    install -m 0644 ${S}/*.ttf ${D}${FONTS_DIR}/

    install -d ${D}${sysconfdir}/fonts/conf.d
    install -m 0644 ${S}/05-nocturne-ro-cachedir.conf \
        ${D}${sysconfdir}/fonts/conf.d/05-nocturne-ro-cachedir.conf
    install -m 0644 ${S}/75-nocturne-circular.conf \
        ${D}${sysconfdir}/fonts/conf.d/75-nocturne-circular.conf

    install -d ${D}${datadir}/fontconfig/cache
}

FILES:${PN} = " \
    ${FONTS_DIR} \
    ${sysconfdir}/fonts/conf.d/05-nocturne-ro-cachedir.conf \
    ${sysconfdir}/fonts/conf.d/75-nocturne-circular.conf \
    ${datadir}/fontconfig/cache \
"

RDEPENDS:${PN} = "fontconfig"
