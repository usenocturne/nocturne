FROM ghcr.io/void-linux/void-glibc:20250401r1
LABEL org.opencontainers.image.licenses="Apache-2.0"

RUN echo "repository=https://mirrors.servercentral.com/voidlinux/current" > /etc/xbps.d/00-repository-main.conf

RUN xbps-install -Suy xbps
RUN xbps-install -uy bash curl dosfstools e2fsprogs findutils util-linux gzip \
    git m4 mtools pigz tar zstd xz zip mkpasswd zip unzip prelink just rsync \
    autoconf automake libtool pkg-config make gcc confuse-devel openssl

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
