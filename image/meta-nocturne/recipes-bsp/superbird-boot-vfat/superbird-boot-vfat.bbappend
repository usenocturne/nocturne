# The BSP boot-vfat recipe assembles the OTA boot member independently from
# the WIC image and therefore does not consume IMAGE_BOOT_FILES. Keep the
# U-Boot splash in that member as well as in the flash image.

DEPENDS:append = " zstd-native"

do_nocturne_boot_logo() {
    mcopy -o -i ${B}/boot.vfat ${DEPLOY_DIR_IMAGE}/logo.bmp ::logo.bmp

    rm -f ${B}/boot.vfat.zck ${B}/boot.vfat.zck.zckheader ${B}/boot.vfat.zst
    zck --output ${B}/boot.vfat.zck -u --chunk-hash-type sha256 ${B}/boot.vfat
    hdr_size=$(zck_read_header -v ${B}/boot.vfat.zck | grep 'Header size' | cut -d ':' -f 2 | tr -d '[:space:]')
    dd if=${B}/boot.vfat.zck of=${B}/boot.vfat.zck.zckheader count=1 bs=$hdr_size
    zstd -19 -T0 -f -k -c ${B}/boot.vfat > ${B}/boot.vfat.zst
}

do_nocturne_boot_logo[depends] += "superbird-logo:do_deploy"
addtask nocturne_boot_logo after do_compile before do_deploy

do_deploy:append() {
    install -m 0644 ${B}/boot.vfat.zst ${DEPLOYDIR}/boot.vfat.zst
}
