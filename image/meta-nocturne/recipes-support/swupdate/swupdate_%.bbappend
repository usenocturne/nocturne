FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

SRC_URI += " \
    file://0002-delta_downloader-add-nocturne-ipc-source.patch \
    ${@'file://nocturne-signed.cfg' if d.getVar('NOCTURNE_SWUPDATE_SIGNING_MODE') == 'production' else ''} \
"

python __anonymous() {
    mode = d.getVar("NOCTURNE_SWUPDATE_SIGNING_MODE")
    if mode not in ("production", "development-unsigned"):
        bb.fatal(
            "NOCTURNE_SWUPDATE_SIGNING_MODE must be 'production' or "
            "'development-unsigned', got %r" % mode
        )
}
