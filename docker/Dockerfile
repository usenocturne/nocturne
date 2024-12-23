FROM alpine:edge

RUN apk add --no-cache nix

RUN echo 'experimental-features = nix-command flakes' >> /etc/nix/nix.conf
RUN echo 'extra-platforms = aarch64-linux' >> /etc/nix/nix.conf

WORKDIR /workdir
