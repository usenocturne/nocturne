FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

SRC_URI:append = " file://nocturne.cfg"

do_install:append() {
    install -d ${D}${sysconfdir}/swupdate/conf.d
    install -m 0644 ${WORKDIR}/nocturne.cfg ${D}${sysconfdir}/swupdate/conf.d/nocturne.cfg
}
