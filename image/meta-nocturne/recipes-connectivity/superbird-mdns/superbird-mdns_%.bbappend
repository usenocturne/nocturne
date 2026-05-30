FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

SRC_URI += " \
    file://nocturne-avahi-runtime.tmpfiles.conf \
"

do_install:append() {
    # Symlink the BSP-rendered Nocturne avahi service into /run/avahi/services/
    # (tmpfiles handles the symlink at boot; the static service file is
    # rendered by superbird-init.service into /run/avahi/services/<name>.service).
    install -d ${D}${nonarch_libdir}/tmpfiles.d
    install -m 0644 ${UNPACKDIR}/nocturne-avahi-runtime.tmpfiles.conf \
        ${D}${nonarch_libdir}/tmpfiles.d/nocturne-avahi-runtime.conf
}

FILES:${PN} += "${nonarch_libdir}/tmpfiles.d/nocturne-avahi-runtime.conf"
