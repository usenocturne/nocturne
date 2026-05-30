SUMMARY = "Nocturne dev-image extras"
DESCRIPTION = "Dev tools, weston VNC backend, ydotool, kitchen-sink CLI utilities."
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

inherit packagegroup

PACKAGES = "${PN}"

RDEPENDS:${PN} = " \
    \
    superbird-weston-init-desktop \
    nocturned-dev-config \
    \
    weston-examples \
    weston-vnc-backend \
    libdrm-tests \
    kmscube \
    glmark2 \
    superbird-gltest \
    wayland-utils \
    \
    ydotool \
    \
    bash \
    coreutils \
    diffutils \
    findutils \
    grep \
    sed \
    tar \
    util-linux \
    curl \
    socat \
    \
    vim-tiny \
    rsync \
    sshfs-fuse \
    tmux \
    jq \
    file \
    iproute2 \
    iproute2-ss \
    lsof \
    psmisc \
    bind-utils \
    gdb \
    gdbserver \
    inotify-tools \
    mmc-utils \
    smartmontools \
    bluez5-noinst-tools \
    \
    htop \
    iotop \
    strace \
    tcpdump \
    \
    i2c-tools \
    libgpiod-tools \
    devmem2 \
    evtest \
"
