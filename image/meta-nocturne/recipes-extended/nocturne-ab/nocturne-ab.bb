SUMMARY = "A/B slot debug helper"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = "file://nocturne-ab.sh"
S = "${UNPACKDIR}"

RDEPENDS:${PN} = "libubootenv-bin"

do_install() {
    install -d ${D}${bindir}
    install -m 0755 ${S}/nocturne-ab.sh ${D}${bindir}/nocturne-ab
}

FILES:${PN} = "${bindir}/nocturne-ab"
