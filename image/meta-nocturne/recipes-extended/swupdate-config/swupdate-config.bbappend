FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

SRC_URI:append = " file://swupdate.cfg file://20-nocturne-version-policy"

FILES:${PN} += " \
    ${sysconfdir}/swupdate.cfg \
    ${libdir}/swupdate/conf.d/20-nocturne-version-policy \
"

do_install:append() {
    install -d ${D}${sysconfdir}
    install -m 0644 ${UNPACKDIR}/swupdate.cfg ${D}${sysconfdir}/swupdate.cfg

    install -d ${D}${libdir}/swupdate/conf.d
    install -m 0644 ${UNPACKDIR}/20-nocturne-version-policy \
        ${D}${libdir}/swupdate/conf.d/20-nocturne-version-policy
}
