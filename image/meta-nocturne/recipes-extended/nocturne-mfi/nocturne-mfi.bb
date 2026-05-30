SUMMARY = "Apple MFi udev rule and helper scripts"
DESCRIPTION = "Wires the Apple MFi authentication i2c chip into /dev/apple_mfi."
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = " \
    file://97-mfi.rules \
    file://add-mfi-dev \
    file://remove-mfi-dev \
"
S = "${UNPACKDIR}"

inherit allarch

do_install() {
    install -d ${D}${sysconfdir}/udev/rules.d
    install -m 0644 ${S}/97-mfi.rules ${D}${sysconfdir}/udev/rules.d/97-mfi.rules

    install -d ${D}${libexecdir}/nocturne
    install -m 0755 ${S}/add-mfi-dev ${D}${libexecdir}/nocturne/add-mfi-dev
    install -m 0755 ${S}/remove-mfi-dev ${D}${libexecdir}/nocturne/remove-mfi-dev
}

FILES:${PN} = " \
    ${sysconfdir}/udev/rules.d/97-mfi.rules \
    ${libexecdir}/nocturne \
"

RDEPENDS:${PN} = "udev"
