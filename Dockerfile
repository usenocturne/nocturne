FROM ghcr.io/void-linux/void-glibc:20250601r1
LABEL org.opencontainers.image.licenses="Apache-2.0"

RUN xbps-install -Suy xbps
RUN xbps-install -Suy curl dosfstools e2fsprogs findutils util-linux \
	git m4 mtools pigz tar zstd xz zip u-boot-tools mkpasswd zip unzip \
	autoconf automake libtool pkg-config make gcc confuse-devel openssl \
	rsync wget

RUN curl -L https://github.com/pengutronix/genimage/archive/refs/tags/v18.tar.gz | tar --use-compress-program=pigz -x -C /tmp \
	&& cd /tmp/genimage-18 \
	&& ./autogen.sh \
	&& ./configure \
	&& make -j$(nproc) \
	&& make install \
	&& cd / \
	&& rm -rf /tmp/genimage-18

ADD ./resources /resources

RUN find /resources/scripts/build-helpers -name "*.sh" -exec install -t /usr/local/bin/ {} \; \
	&& cd /usr/local/bin && for file in *.sh; do mv -- "$file" "$(basename "$file" .sh)"; done \
	&& echo "installed:" && ls /usr/local/bin

WORKDIR /work

CMD ["/bin/sh", "/resources/build.sh"]
