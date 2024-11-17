build:
  nix build '.#nixosConfigurations.superbird.config.system.build.installer' -j"$(nproc)" --show-trace

installer:
  #!/bin/bash
  set -euo pipefail

  nix build '.#nixosConfigurations.superbird.config.system.build.installer' -j8 --show-trace
  echo "kernel is $(stat -Lc%s -- result/linux/kernel | numfmt --to=iec)"
  echo "initrd is $(stat -Lc%s -- result/linux/initrd.img | numfmt --to=iec)"
  echo "rootfs (sparse) is $(stat -Lc%s -- result/linux/rootfs.img | numfmt --to=iec)"

  sudo rm -rf ./out
  mkdir ./out
  cp -r ./result/* ./out/
  chown -R $(whoami):$(whoami) ./out
  cd ./out

  sudo ./scripts/shrink-img.sh
  echo "rootfs (compact) is $(stat -Lc%s -- ./linux/rootfs.img | numfmt --to=iec)"

run-installer:
  just installer
  cd out && ./install.sh

zip-installer:
  #!/bin/bash
  set -euo pipefail

  cd ./out/
  zip -r nixos-superbird-installer.zip .

push:
  nix run github:serokell/deploy-rs

cache:
  attic push nocturne $(nix build .#nixosConfigurations.superbird.config.system.build.toplevel --no-link --print-out-paths)

docker-installer:
  docker run --privileged --rm -it -v ./:/workdir -v nix-store:/nix -v nix-root:/root d10dcb4a9a66

docker-cache:
  docker run --privileged --rm -it -v ./:/workdir -v nix-store:/nix -v nix-root:/root d10dcb4a9a66 /usr/bin/env bash -c "just cache"
