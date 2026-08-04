SUMMARY = "Nocturne daemon"
DESCRIPTION = "Nocturne Rust daemon."
LICENSE = "GPL-3.0-only"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/GPL-3.0-only;md5=c79ff39f19dfec6d293b95dea7b07891"

require recipes-core/nocturne-monorepo.inc

inherit cargo systemd pkgconfig

SRC_URI += "file://nocturned.service \
            file://nocturned.conf \
            file://nocturned-rollback \
            file://nocturned-rollback.service \
            file://nocturned-dev.conf"

do_compile[network] = "1"
CARGO_DISABLE_BITBAKE_VENDORING = "1"
CARGO_BUILD_FLAGS:remove = "--frozen"
CARGO_BUILD_FLAGS:append = " --locked"
CARGO_BUILD_FLAGS:append = " --package nocturned"
CARGO_BUILD_FLAGS:append = " --features device"

export LIBCLANG_PATH = "${STAGING_LIBDIR_NATIVE}"
export BINDGEN_EXTRA_CLANG_ARGS = "--sysroot=${RECIPE_SYSROOT}"

DEPENDS = "dbus libopus swupdate clang-native"

SYSTEMD_SERVICE:${PN} = "nocturned.service"
SYSTEMD_AUTO_ENABLE = "enable"

RDEPENDS:${PN} += "opt-overlay bluez5 alsa-utils nocturne-models"

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
