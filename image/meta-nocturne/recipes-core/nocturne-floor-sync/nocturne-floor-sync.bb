SUMMARY = "Nocturne bandaid floor sync"
DESCRIPTION = "On boot, compares the rootfs-baked daemon + UI floor versions against the bandaid versions. If rootfs is newer (i.e. an OS OTA just shipped new defaults), atomically copies the new files into bandaid so the running system uses the new versions. This closes the gap where full SWU updates only rewrite boot+rootfs but leave the bandaid partition stale."
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = " \
    file://nocturne-floor-sync.service \
    file://nocturne-floor-sync \
"
S = "${UNPACKDIR}"

inherit systemd allarch

SYSTEMD_SERVICE:${PN} = "nocturne-floor-sync.service"
SYSTEMD_AUTO_ENABLE = "enable"

RDEPENDS:${PN} = "opt-overlay coreutils"

do_install() {
    install -d ${D}${libexecdir}
    install -m 0755 ${S}/nocturne-floor-sync ${D}${libexecdir}/nocturne-floor-sync

    install -d ${D}${systemd_system_unitdir}
    install -m 0644 ${S}/nocturne-floor-sync.service \
        ${D}${systemd_system_unitdir}/nocturne-floor-sync.service
}

FILES:${PN} = " \
    ${libexecdir}/nocturne-floor-sync \
    ${systemd_system_unitdir}/nocturne-floor-sync.service \
"
