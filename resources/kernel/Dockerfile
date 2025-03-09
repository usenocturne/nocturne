FROM nixos/nix AS base

FROM base AS build-amd64

RUN <<EOR
tee /etc/nix/nix.conf << EOF
build-users-group = nixbld
filter-syscalls = false
sandbox = true
experimental-features = nix-command flakes
extra-platforms = aarch64-linux
accept-flake-config = true
auto-optimise-store = true
substitute = true
substituters = https://cache.nixos.org https://nix-community.cachix.org https://superbird.attic.claiborne.soy/superbird
trusted-public-keys = cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY= nix-community.cachix.org-1:mB9FSh9qf2dCimDSUo8Zy7bkq5CX+/rkCWyvRCYg3Fs= superbird:r9Hm/REl7BEr6+9UQoS+nxzqxY2sKUhsDCNy5PGQbDU=
EOF
EOR

RUN nix-channel --update
RUN nix-env -iA nixpkgs.qemu

# 2nd stage
FROM build-amd64 AS build

RUN nix-env -iA \
    nixpkgs.git \
    nixpkgs.util-linux \
    nixpkgs.btrfs-progs \
    nixpkgs.gawk \
    nixpkgs.perl

RUN git config --global --add safe.directory /workdir

WORKDIR /workdir
