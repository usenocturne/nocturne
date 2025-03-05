ARG ALPINE_VER=3.21

####
FROM docker.io/alpine:$ALPINE_VER AS keys

RUN apk add alpine-keys

####
FROM docker.io/alpine:$ALPINE_VER
LABEL org.opencontainers.image.licenses="Apache-2.0"

RUN apk add --no-cache --upgrade curl dosfstools e2fsprogs-extra findutils \
	genimage git m4 mtools pigz tar zstd u-boot-tools

ADD ./resources /resources
COPY --from=keys /usr/share/apk/keys /usr/share/apk/keys-stable

RUN find /resources/scripts/build-helpers -name "*.sh" -exec install -t /usr/local/bin/ {} \; \
	&&  cd /usr/local/bin && for file in *.sh; do mv -- "$file" "$(basename "$file" .sh)"; done \
	&&  echo "installed:" && ls /usr/local/bin

WORKDIR /work

CMD ["/bin/sh", "/resources/build.sh"]
