nocturne_chromium_slim () {
    if [ -d ${IMAGE_ROOTFS}${libdir}/chromium/chromecast_locales ]; then
        find ${IMAGE_ROOTFS}${libdir}/chromium/chromecast_locales \
            -maxdepth 1 -type f -name '*.pak' \
            ! -name 'en.pak' \
            ! -name 'en-US.pak' \
            ! -name 'en-GB.pak' \
            -delete
    fi

    if [ -d ${IMAGE_ROOTFS}${libdir}/chromium/locales ]; then
        find ${IMAGE_ROOTFS}${libdir}/chromium/locales \
            -maxdepth 1 -type f -name '*.pak' \
            ! -name 'en.pak' \
            ! -name 'en-US.pak' \
            ! -name 'en-GB.pak' \
            -delete
    fi

    rm -f ${IMAGE_ROOTFS}${libdir}/chromium/libvk_swiftshader.so
    rm -f ${IMAGE_ROOTFS}${libdir}/chromium/vk_swiftshader_icd.json
}

ROOTFS_POSTPROCESS_COMMAND += "nocturne_chromium_slim;"

nocturne_chromium_unincognito () {
    if [ -f ${IMAGE_ROOTFS}${libdir}/chromium/chromium-wrapper ]; then
        sed -i 's/--incognito//g' ${IMAGE_ROOTFS}${libdir}/chromium/chromium-wrapper
    fi
}

ROOTFS_POSTPROCESS_COMMAND += "nocturne_chromium_unincognito;"
