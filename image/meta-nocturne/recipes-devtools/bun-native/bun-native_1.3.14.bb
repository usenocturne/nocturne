SUMMARY = "Bun JavaScript runtime"
DESCRIPTION = "Pre-built bun binary staged into the native sysroot for webapp recipes."
HOMEPAGE = "https://bun.com/"
LICENSE = "MIT & LGPL-2.0-only & BSD-2-Clause & Zlib"

inherit native

# Keep PV in sync with `packageManager` in the monorepo's root package.json so
# the container and a developer's host resolve bun.lock identically.

# bun publishes per-host-arch zips; map BUILD_ARCH to the upstream naming.
python () {
    arch_map = {'x86_64': 'x64', 'aarch64': 'aarch64'}
    build_arch = d.getVar('BUILD_ARCH')
    bun_arch = arch_map.get(build_arch)
    if not bun_arch:
        bb.fatal("bun-native: unsupported BUILD_ARCH %r (expected one of %s)"
                 % (build_arch, ', '.join(arch_map.keys())))
    d.setVar('BUN_ARCH', bun_arch)
}

SRC_URI = "https://github.com/oven-sh/bun/releases/download/bun-v${PV}/bun-linux-${BUN_ARCH}.zip;name=bun-${BUN_ARCH} \
           file://LICENSE.md"

SRC_URI[bun-x64.sha256sum] = "951ee2aee855f08595aeec6225226a298d3fea83a3dcd6465c09cbccdf7e848f"
SRC_URI[bun-aarch64.sha256sum] = "a27ffb63a8310375836e0d6f668ae17fa8d8d18b88c37c821c65331973a19a3b"

LIC_FILES_CHKSUM = "file://${UNPACKDIR}/LICENSE.md;md5=3fc8b6c4e6874a69f48bc724eb8e4ce3"

S = "${UNPACKDIR}/bun-linux-${BUN_ARCH}"

do_configure() {
    :
}

do_compile() {
    :
}

do_install() {
    install -d ${D}${bindir}
    install -m 0755 ${S}/bun ${D}${bindir}/bun
}

# prebuilt single static binary; no debug info to split
INSANE_SKIP:${PN} += "already-stripped"
