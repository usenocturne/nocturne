DEPENDS:append = " zstd-native"

do_compile:append() {
    rm -f ${B}/boot.vfat.zst
    zstd -19 -T0 -f -k -c ${B}/boot.vfat > ${B}/boot.vfat.zst
}

do_deploy:append() {
    install -m 0644 ${B}/boot.vfat.zst ${DEPLOYDIR}/boot.vfat.zst
}
