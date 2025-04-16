#!/bin/sh -x

if [ ! "$(docker volume inspect nix-store 2> /dev/null)" ]; then
  docker volume create nix-store
fi

if [ ! "$(docker volume inspect nix-root 2> /dev/null)" ]; then
  docker volume create nix-root
fi

sudo rm -rf ./output
mkdir -p ./output

IMAGE_ID=$(docker build .)

docker run --privileged --rm -it -v nix-store:/nix -v nix-root:/root -v ./:/workdir "$IMAGE_ID" /usr/bin/env bash -c \
  "nix build github:JoeyEamigh/nixos-superbird#nixosConfigurations.headless-example.config.system.build.kernel --print-out-paths && cp -r result/* output/"

