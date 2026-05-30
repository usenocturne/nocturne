SUMMARY = "Nocturne daemon"
DESCRIPTION = "Nocturne Rust daemon."
HOMEPAGE = "https://github.com/usenocturne/nocturned"
LICENSE = "GPL-3.0-only"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/GPL-3.0-only;md5=c79ff39f19dfec6d293b95dea7b07891"

inherit cargo systemd pkgconfig

SRC_URI = "gitsm://github.com/usenocturne/nocturned.git;protocol=https;branch=main;destsuffix=${BP} \
           file://nocturned.service \
           file://nocturned.conf \
           file://nocturned-rollback \
           file://nocturned-rollback.service \
           file://nocturned-dev.conf"
# TODO: pin this to the real v2.1.0 SHA once nocturned's OTA branch is merged and tagged.
# This Yocto PV is intentionally forward-looking; nocturned Cargo.toml remains 2.0.4 until that tag exists.
SRCREV = "AUTOREV"

do_compile[network] = "1"
CARGO_DISABLE_BITBAKE_VENDORING = "1"
CARGO_BUILD_FLAGS:remove = "--frozen"
CARGO_BUILD_FLAGS:append = " --locked"
CARGO_BUILD_FLAGS:append = " --features device"

export LIBCLANG_PATH = "${STAGING_LIBDIR_NATIVE}"
export BINDGEN_EXTRA_CLANG_ARGS = "--sysroot=${RECIPE_SYSROOT}"

DEPENDS = "dbus libopus swupdate clang-native"

SYSTEMD_SERVICE:${PN} = "nocturned.service"
SYSTEMD_AUTO_ENABLE = "enable"

RDEPENDS:${PN} += "opt-overlay bluez5 alsa-utils nocturne-models nocturne-mfi"

DAEMON_FLOOR_DIR = "${nonarch_libdir}/nocturne/daemon"

OPT_OVERLAY_TARGET = "/opt/nocturne"

do_install() {
    install -d ${D}${OPT_OVERLAY_TARGET}

    install -d ${D}${DAEMON_FLOOR_DIR}
    install -m 0755 ${B}/target/${CARGO_TARGET_SUBDIR}/nocturned \
        ${D}${DAEMON_FLOOR_DIR}/nocturned.current

    install -d ${D}${libexecdir}
    install -m 0755 ${UNPACKDIR}/nocturned-rollback \
        ${D}${libexecdir}/nocturned-rollback

    install -d ${D}${systemd_system_unitdir}
    install -m 0644 ${UNPACKDIR}/nocturned.service \
        ${D}${systemd_system_unitdir}/nocturned.service
    install -m 0644 ${UNPACKDIR}/nocturned-rollback.service \
        ${D}${systemd_system_unitdir}/nocturned-rollback.service

    install -d ${D}${nonarch_libdir}/tmpfiles.d
    install -m 0644 ${UNPACKDIR}/nocturned.conf \
        ${D}${nonarch_libdir}/tmpfiles.d/nocturned.conf

    install -d ${D}${systemd_system_unitdir}/nocturned.service.d
    install -m 0644 ${UNPACKDIR}/nocturned-dev.conf \
        ${D}${systemd_system_unitdir}/nocturned.service.d/dev.conf
}

PACKAGES =+ "${PN}-dev-config"

FILES:${PN} = " \
    ${OPT_OVERLAY_TARGET} \
    ${DAEMON_FLOOR_DIR}/nocturned.current \
    ${libexecdir}/nocturned-rollback \
    ${systemd_system_unitdir}/nocturned.service \
    ${systemd_system_unitdir}/nocturned-rollback.service \
    ${nonarch_libdir}/tmpfiles.d/nocturned.conf \
"

FILES:${PN}-dev-config = "${systemd_system_unitdir}/nocturned.service.d/dev.conf"
RDEPENDS:${PN}-dev-config = "${PN}"
SUMMARY:${PN}-dev-config = "Nocturne daemon dev drop-in (trace logs + uart mirror)"

INSANE_SKIP:${PN} += "already-stripped"
