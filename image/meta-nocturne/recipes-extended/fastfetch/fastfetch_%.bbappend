FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

SRC_URI += " \
    file://nocturne.jsonc \
    file://nocturne-logo.txt \
"

do_install:append() {
    install -d ${D}${sysconfdir}/fastfetch
    install -m 0644 ${UNPACKDIR}/nocturne.jsonc      ${D}${sysconfdir}/fastfetch/config.jsonc
    install -m 0644 ${UNPACKDIR}/nocturne-logo.txt   ${D}${sysconfdir}/fastfetch/ascii-logo.txt
}
