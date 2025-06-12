#!/bin/sh

rsync -aAXv "$RES_PATH"/stock-files/output/ "$ROOTFS_PATH"/

ln -sf libweston-3.so.0.0.0 "$ROOTFS_PATH"/usr/lib/libweston-3.so.0
ln -sf libwayland-server.so.0.1.0 "$ROOTFS_PATH"/usr/lib/libwayland-server.so.0
ln -sf libpixman-1.so.0.34.0 "$ROOTFS_PATH"/usr/lib/libpixman-1.so.0
ln -sf libxkbcommon.so.0.0.0 "$ROOTFS_PATH"/usr/lib/libxkbcommon.so.0
ln -sf libinput.so.10.13.0 "$ROOTFS_PATH"/usr/lib/libinput.so.10
ln -sf libmtdev.so.1.0.0 "$ROOTFS_PATH"/usr/lib/libmtdev.so.1
ln -sf libevdev.so.2.2.0 "$ROOTFS_PATH"/usr/lib/libevdev.so.2
ln -sf libffi.so.7.1.0 "$ROOTFS_PATH"/usr/lib/libffi.so.7
ln -sf libdrm.so.2.4.0 "$ROOTFS_PATH"/usr/lib/libdrm.so.2
ln -sf libMali.so "$ROOTFS_PATH"/usr/lib/libgbm.so
ln -sf libMali.so "$ROOTFS_PATH"/usr/lib/libEGL.so.1.4
ln -sf libMali.so "$ROOTFS_PATH"/usr/lib/libGLESv1_CM.so.1.1
ln -sf libMali.so "$ROOTFS_PATH"/usr/lib/libGLESv2.so.2.0
ln -sf libMali.so "$ROOTFS_PATH"/usr/lib/libwayland-egl.so
ln -sf libwayland-client.so.0.3.0 "$ROOTFS_PATH"/usr/lib/libwayland-client.so.0
ln -sf libEGL.so.1.4 "$ROOTFS_PATH"/usr/lib/libEGL.so
ln -sf libGLESv2.so.2.0 "$ROOTFS_PATH"/usr/lib/libGLESv2.so
ln -sf libweston-desktop-3.so.0.0.0 "$ROOTFS_PATH"/usr/lib/libweston-desktop-3.so.0
ln -sf libwayland-cursor.so.0.0.0 "$ROOTFS_PATH"/usr/lib/libwayland-cursor.so.0
ln -sf libcairo.so.2.11512.0 "$ROOTFS_PATH"/usr/lib/libcairo.so.2
ln -sf libatomic.so.1.2.0 "$ROOTFS_PATH"/usr/lib/libatomic.so.1
ln -sf libwebp.so.7.0.3 "$ROOTFS_PATH"/usr/lib/libwebp.so.7
ln -sf libjpeg.so.9.3.0 "$ROOTFS_PATH"/usr/lib/libjpeg.so.9

execstack -c "$ROOTFS_PATH"/usr/lib/libMali.so
