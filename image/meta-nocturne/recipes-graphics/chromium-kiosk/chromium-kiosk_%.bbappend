FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

SRC_URI += "file://nocturned-readiness.conf"

do_install:append() {
    install -d ${D}${sysconfdir}/default
    cat >> ${D}${sysconfdir}/default/chromium-kiosk <<'EOF'
KIOSK_ENV_OVERRIDE_FILE=/opt/nocturne/kiosk-env
EOF

    install -d ${D}${systemd_system_unitdir}/chromium-kiosk.service.d
    install -m 0644 ${UNPACKDIR}/nocturned-readiness.conf \
        ${D}${systemd_system_unitdir}/chromium-kiosk.service.d/nocturned-readiness.conf
}

FILES:${PN}:append = " ${systemd_system_unitdir}/chromium-kiosk.service.d/nocturned-readiness.conf"
RDEPENDS:${PN}:remove = "noto-sans-cjk"
RDEPENDS:${PN}:append = " busybox nocturned"
