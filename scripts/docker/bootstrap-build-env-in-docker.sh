#!/bin/bash

cd ~/void-packages

# Create libconfuse template
mkdir -p srcpkgs/libconfuse
cat > srcpkgs/libconfuse/template <<EOF
pkgname=libconfuse
version=3.3
revision=1
build_style=gnu-configure
short_desc="Configuration file parser library"
maintainer="you@example.com"
license="ISC"
homepage="https://github.com/libconfuse/libconfuse"
distfiles="https://github.com/libconfuse/libconfuse/releases/download/v\${version}/confuse-\${version}.tar.xz"
checksum=1dd50a0320e135a55025b23fcdbb3f0a81913b6d0b0a9df8cc2fdf3b3dc67010
EOF

# Create genimage template with custom install step
mkdir -p srcpkgs/genimage
cat > srcpkgs/genimage/template <<'EOF'
pkgname=genimage
version=19
revision=1
wrksrc="${pkgname}-${version}"
build_style=gnu-configure
hostmakedepends="pkg-config automake autoconf libtool"
makedepends="libconfuse"
short_desc="Tool to generate complete filesystem images"
maintainer="you@example.com"
license="GPL-2.0-only"
homepage="https://github.com/pengutronix/genimage"
distfiles="https://github.com/pengutronix/genimage/releases/download/v${version}/genimage-${version}.tar.xz"
checksum=7ec4fcb865662a8b2ff20284819044ffa84137bf3ca16fb749701291bc01f108
EOF

# Prepare xbps-src
echo "XBPS_ALLOW_CHROOT_BREAKOUT=yes" >> etc/conf
echo "BUILD_CHROOT=false" >> etc/conf

RUN xbps-install -Sy glibc-locales && \
    localedef -i en_US -f UTF-8 en_US.UTF-8

ENV LANG=en_US.UTF-8 \
    LC_ALL=en_US.UTF-8

# Build packages
./xbps-src binary-bootstrap
./xbps-src pkg libconfuse
./xbps-src pkg genimage

# Resolve libconfuse confusion
sudo xbps-install -y -R hostdir/binpkgs libconfuse

# Manually install mkpasswd
wget https://ftp.debian.org/debian/pool/main/w/whois/whois_5.5.17.tar.xz
tar -xf whois_5.5.17.tar.xz
cd whois-5.5.17
make mkpasswd
sudo install -Dm755 mkpasswd /usr/bin/mkpasswd

# Force install genimage
cd ~/void-packages
sudo xbps-install -y -R hostdir/binpkgs genimage
