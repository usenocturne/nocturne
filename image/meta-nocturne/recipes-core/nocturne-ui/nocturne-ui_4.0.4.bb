SUMMARY = "Nocturne UI"
DESCRIPTION = "Static web UI for Nocturne."
HOMEPAGE = "https://github.com/usenocturne/nocturne-ui"
LICENSE = "GPL-3.0-only"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/GPL-3.0-only;md5=c79ff39f19dfec6d293b95dea7b07891"

# Pinned prebuilt zip artifact. Capture sha256 at release time via:
#   curl -L https://nightly.link/usenocturne/nocturne-ui/workflows/build/v${PV}/nocturne-ui.zip \
#     | sha256sum
# Replace SRC_URI[ui.sha256sum] with the real value before declaring a reproducible release.
# Long term: mirror the artifact to https://ota.usenocturne.com/artifacts/ and switch SRC_URI.
SRC_URI = "https://nightly.link/usenocturne/nocturne-ui/workflows/build/v${PV}/nocturne-ui.zip;name=ui;subdir=${BP}"
SRC_URI[ui.sha256sum] = "0000000000000000000000000000000000000000000000000000000000000000"

S = "${UNPACKDIR}/${BP}"

inherit allarch

WEBAPP_DIR = "${nonarch_libdir}/nocturne/webapps/ui"

do_install() {
    install -d ${D}${WEBAPP_DIR}
    cp -r ${S}/. ${D}${WEBAPP_DIR}/
    chown -R root:root ${D}${WEBAPP_DIR}
    find ${D}${WEBAPP_DIR} -type d -exec chmod 0755 {} \;
    find ${D}${WEBAPP_DIR} -type f -exec chmod 0644 {} \;
}

FILES:${PN} = "${WEBAPP_DIR}"

RDEPENDS:${PN} = "opt-overlay"
