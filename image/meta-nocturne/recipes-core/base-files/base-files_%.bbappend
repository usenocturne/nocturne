FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

do_install:append() {
    sed -i \
        -e 's|@@VERSION@@|${DISTRO_VERSION}|g' \
        -e 's|@@BUILD_ID@@|${NOCTURNE_BUILD_ID}|g' \
        "${D}${sysconfdir}/motd"
}
