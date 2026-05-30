do_install:append() {
    install -d ${D}${sysconfdir}/default
    cat >> ${D}${sysconfdir}/default/chromium-kiosk <<'EOF'
KIOSK_ENV_OVERRIDE_FILE=/opt/nocturne/kiosk-env
EOF
}
