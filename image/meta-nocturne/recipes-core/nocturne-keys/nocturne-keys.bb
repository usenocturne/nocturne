SUMMARY = "Nocturne OTA public signing key"
LICENSE = "CLOSED"

SRC_URI = "file://nocturne.pem"

S = "${UNPACKDIR}"

inherit allarch

do_install() {
    install -d ${D}${sysconfdir}
    install -m 0644 ${UNPACKDIR}/nocturne.pem ${D}${sysconfdir}/nocturne.pem
}

FILES:${PN} = "${sysconfdir}/nocturne.pem"
