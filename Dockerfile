FROM ghcr.io/void-linux/void-glibc:20250801R1
LABEL org.opencontainers.image.licenses="Apache-2.0"

# https://docs.voidlinux.org/xbps/repositories/mirrors/changing.html
RUN mkdir -p /etc/xbps.d && \
    cp /usr/share/xbps.d/*-repository-*.conf /etc/xbps.d/ && \
    sed -i 's|https://repo-default.voidlinux.org|https://mirrors.servercentral.com/voidlinux|g' /etc/xbps.d/*-repository-*.conf

RUN xbps-install -Suy xbps

RUN xbps-install -uy bash curl dosfstools e2fsprogs findutils util-linux gzip \
    git m4 mtools pigz tar zstd xz zip mkpasswd zip unzip just rsync \
    autoconf automake libtool pkg-config make gcc confuse-devel openssl patchelf

RUN curl -L https://github.com/pengutronix/genimage/archive/refs/tags/v18.tar.gz | tar --use-compress-program=pigz -x -C /tmp \
    && cd /tmp/genimage-18 \
    && ./autogen.sh \
    && ./configure \
    && make -j$(nproc) \
    && make install \
    && cd / \
    && rm -rf /tmp/genimage-18

COPY resources/ /work/resources/
COPY scripts/ /work/scripts/
COPY docker-entrypoint.sh build.sh /work/

WORKDIR /work

CMD ["/bin/bash", "/work/docker-entrypoint.sh"]
