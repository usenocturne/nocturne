SUMMARY = "Nocturne UI fonts (CircularSp, Inter, Noto subset)"
DESCRIPTION = "Bundled TTFs the nocturne-ui SPA references via CSS @font-face."
LICENSE = "MIT & OFL-1.1"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = " \
    file://CircularSp-Arab-Black.ttf \
    file://CircularSp-Arab-Bold.ttf \
    file://CircularSp-Arab-Book.ttf \
    file://CircularSp-Cyrl-Black.ttf \
    file://CircularSp-Cyrl-Bold.ttf \
    file://CircularSp-Cyrl-Book.ttf \
    file://CircularSp-Deva-Black.ttf \
    file://CircularSp-Deva-Bold.ttf \
    file://CircularSp-Deva-Book.ttf \
    file://CircularSp-Grek-Black.ttf \
    file://CircularSp-Grek-Bold.ttf \
    file://CircularSp-Grek-Book.ttf \
    file://CircularSp-Hebr-Black.ttf \
    file://CircularSp-Hebr-Bold.ttf \
    file://CircularSp-Hebr-Book.ttf \
    file://CircularSpUIv3T-Black.ttf \
    file://CircularSpUIv3T-Bold.ttf \
    file://CircularSpUIv3T-Book.ttf \
    file://Inter-Bold.ttf \
    file://Inter-Medium.ttf \
    file://Inter-Regular.ttf \
    file://Inter-SemiBold.ttf \
    file://NotoColorEmoji.ttf \
    file://NotoNaskhAR-VF.ttf \
    file://NotoSansBN-VF.ttf \
    file://NotoSansDV-VF.ttf \
    file://NotoSansGK-VF.ttf \
    file://NotoSansHE-VF.ttf \
    file://NotoSansJP-VF.ttf \
    file://NotoSansKR-VF.ttf \
    file://NotoSansSC-VF.ttf \
    file://NotoSansTA-VF.ttf \
    file://NotoSansTC-VF.ttf \
    file://NotoSansTH-VF.ttf \
    file://NotoSerifJP-VF.ttf \
    file://NotoSerifKR-VF.ttf \
"
S = "${UNPACKDIR}"

inherit allarch

FONTS_DIR = "${datadir}/fonts/nocturne"

do_install() {
    install -d ${D}${FONTS_DIR}
    install -m 0644 ${S}/*.ttf ${D}${FONTS_DIR}/
}

FILES:${PN} = "${FONTS_DIR}"

RDEPENDS:${PN} = "fontconfig"
