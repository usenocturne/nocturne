FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

# Drop our 800x480 PNG into the BSP's weston-init recipe via FILESEXTRAPATHS.
# The BSP recipe pulls the file referenced by SUPERBIRD_WESTON_SPLASH_IMAGE,
# which the distro conf points at nocturne-splash.png.
SRC_URI += "file://${SUPERBIRD_WESTON_SPLASH_IMAGE}"
