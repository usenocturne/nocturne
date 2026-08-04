SUMMARY = "Nocturne UI"
DESCRIPTION = "Static web UI for Nocturne, built from the monorepo's packages/ui."
LICENSE = "GPL-3.0-only"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/GPL-3.0-only;md5=c79ff39f19dfec6d293b95dea7b07891"

require recipes-core/nocturne-monorepo.inc

inherit allarch

DEPENDS = "bun-native"

# bun resolves the dependency graph from the network, same as cargo does for
# nocturned. Neither recipe is offline-reproducible.
do_compile[network] = "1"

# bun writes caches and state under $HOME; keep it in the workdir instead of
# letting it escape to the builder's real home.
BUN_HOME = "${WORKDIR}/bun-home"

UI_DIST = "${S}/packages/ui/dist"

do_compile() {
    cd ${S}

    install -d ${BUN_HOME}
    export HOME=${BUN_HOME}

    # install at the workspace root so packages/ui's deps resolve, then defer
    # to the repo's own build script rather than restating it here. Note this
    # couples the recipe to the root package.json's "ui:build" - keep them
    # together. bun exits 0 when `bun run` rejects its own flags, so a broken
    # script here would install a stale dist/ instead of failing; the
    # index.html check in do_install only catches a missing bundle, not a
    # stale one.
    bun install --frozen-lockfile --no-progress
    bun run ui:build
}

WEBAPP_DIR = "${nonarch_libdir}/nocturne/webapps/ui"

do_install() {
    if [ ! -f ${UI_DIST}/index.html ]; then
        bbfatal "nocturne-ui: ${UI_DIST}/index.html missing after build"
    fi

    install -d ${D}${WEBAPP_DIR}
    cp -r ${UI_DIST}/. ${D}${WEBAPP_DIR}/
    chown -R root:root ${D}${WEBAPP_DIR}
    find ${D}${WEBAPP_DIR} -type d -exec chmod 0755 {} \;
    find ${D}${WEBAPP_DIR} -type f -exec chmod 0644 {} \;
}

FILES:${PN} = "${WEBAPP_DIR}"

RDEPENDS:${PN} = "opt-overlay"
