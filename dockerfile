FROM voidlinux/voidlinux:latest

ENV LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 TERM=xterm

RUN echo "repository=https://repo-fastly.voidlinux.org/current" > /etc/xbps.d/00-repository-main.conf

# Set mirror and update xbps & certs
RUN echo "repository=https://repo-fastly.voidlinux.org/current" > /etc/xbps.d/00-repository-main.conf
RUN xbps-install -Sy xbps
RUN xbps-install -Sy ca-certificates
RUN update-ca-certificates
RUN xbps-install -Sy bash

# Install development tools one-by-one (or in small related groups)
RUN xbps-install -Sy base-devel
RUN xbps-install -Sy git
RUN xbps-install -Sy curl
RUN xbps-install -Sy zip
RUN xbps-install -Sy unzip
RUN xbps-install -Sy m4
RUN xbps-install -Sy whois
RUN xbps-install -Sy pkg-config
RUN xbps-install -Sy sudo
RUN xbps-install -Sy fakeroot
RUN xbps-install -Sy rsync
RUN xbps-install -Sy lz4
RUN xbps-install -Sy python3
RUN xbps-install -Sy automake
RUN xbps-install -Sy autoconf
RUN xbps-install -Sy libtool
RUN xbps-install -Sy wget
RUN xbps-install -Sy go
RUN xbps-install -Sy cpio
RUN xbps-install -Sy zstd
RUN xbps-install -y dosfstools
RUN xbps-install -y prelink
RUN xbps-install -y e2fsprogs
RUN xbps-install -y pigz
RUN xbps-install -y mtools

# Install just binary from GitHub releases
RUN curl -L https://github.com/casey/just/releases/download/1.42.2/just-1.42.2-x86_64-unknown-linux-musl.tar.gz \
    | tar -xz -C /usr/local/bin just

RUN useradd -m builder && echo "builder ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/builder
USER builder
WORKDIR /home/builder

RUN git clone --depth=1 https://github.com/void-linux/void-packages.git

# Force locale
RUN xbps-install -Sy glibc-locales && \
    localedef -i en_US -f UTF-8 en_US.UTF-8

ENV LANG=en_US.UTF-8 \
    LC_ALL=en_US.UTF-8

COPY scripts/docker/bootstrap-build-env-in-docker.sh /home/builder/finish-init.sh
RUN sudo chmod +x /home/builder/finish-init.sh

CMD ["/bin/bash"]
