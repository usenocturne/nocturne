SUMMARY = "Nocturne persistent state directory declarations"
LICENSE = "CLOSED"

SRC_URI = "file://nocturne-state-dirs.conf"

S = "${UNPACKDIR}"

inherit allarch

do_install() {
    install -d ${D}${nonarch_libdir}/tmpfiles.d
    install -m 0644 ${UNPACKDIR}/nocturne-state-dirs.conf ${D}${nonarch_libdir}/tmpfiles.d/nocturne-state-dirs.conf
}

FILES:${PN} = "${nonarch_libdir}/tmpfiles.d/nocturne-state-dirs.conf"
