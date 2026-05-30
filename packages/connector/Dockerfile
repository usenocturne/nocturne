FROM alpine:3.21

ARG BUN_VERSION=1.3.13
ARG TARGETARCH

RUN apk add --no-cache \
        bash \
        ca-certificates \
        coreutils \
        curl \
        dosfstools \
        e2fsprogs \
        e2fsprogs-extra \
        genimage \
        git \
        gzip \
        libc6-compat \
        libgcc \
        libstdc++ \
        m4 \
        mtools \
        parted \
	pigz \
	rsync \
        tar \
        util-linux \
        whois \
        xz \
        zip \
        unzip

# Bun install
RUN set -eu; \
    case "${TARGETARCH:-$(apk --print-arch)}" in \
      amd64|x86_64)         BUN_ARCH=x64 ;; \
      arm64|aarch64)        BUN_ARCH=aarch64 ;; \
      *) echo "unsupported arch: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fL "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-${BUN_ARCH}-musl.zip" \
      -o /tmp/bun.zip; \
    unzip -j /tmp/bun.zip -d /tmp/bun; \
    install -m 0755 /tmp/bun/bun /usr/local/bin/bun; \
    ln -s /usr/local/bin/bun /usr/local/bin/bunx; \
    rm -rf /tmp/bun /tmp/bun.zip; \
    bun --version

COPY resources/ /work/resources/
COPY scripts/ /work/scripts/
COPY src/ /work/src/
COPY build.sh /work/

WORKDIR /work

CMD ["bash", "-c", "cd /work/src && bun install && bun run check && bun run build && cd /work && ./build.sh"]

