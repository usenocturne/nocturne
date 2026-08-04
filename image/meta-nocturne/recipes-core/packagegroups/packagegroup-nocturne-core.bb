SUMMARY = "Nocturne core runtime"
DESCRIPTION = "nocturned + nocturne-ui + weston/chromium, on top of packagegroup-superbird-runtime."
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

inherit packagegroup

PACKAGES = "${PN}"

RDEPENDS:${PN} = " \
    packagegroup-superbird-runtime \
    \
    nocturned \
    nocturne-ui \
    nocturne-models \
    nocturne-fonts \
    nocturne-ab \
    nocturne-floor-sync \
    nocturne-keys \
    nocturne-state-dirs \
    swupdate \
    swupdate-client \
    swupdate-tools \
    libubootenv-bin \
    \
    mesa \
    weston \
    blank-cursor \
    cursor-suppress \
    superbird-fbpaint \
    \
    chromium-ozone-wayland \
    chromium-kiosk \
    \
    fastfetch \
"
