docker-shell:
  docker compose run --rm nix nix-shell docker/shell.nix

build config="superbird":
  nix build '.#nixosConfigurations.{{config}}.config.system.build.toplevel' -j$(nproc) --show-trace

fs config="superbird":
  nix build '.#nixosConfigurations.{{config}}.config.system.build.btrfs' -j$(nproc) --show-trace
  echo "rootfs is $(stat -Lc%s -- result | numfmt --to=iec)"

installer config="superbird":
  #!/usr/bin/env bash
  set -euo pipefail

  nix build '.#nixosConfigurations.{{config}}.config.system.build.installer' -j$(nproc) --show-trace
  echo "kernel is $(stat -Lc%s -- result/builder/kernel | numfmt --to=iec)"
  echo "rootfs is $(stat -Lc%s -- result/rootfs.img | numfmt --to=iec)"

  sudo rm -rf ./out
  mkdir ./out
  cp -r ./result/* ./out/
  chown -R $(whoami):$(whoami) ./out
  cd ./out

  sudo ./scripts/make-bootfs.sh
  echo "bootfs built!"

  just zip-installer

run-installer config="superbird":
  just installer {{config}}
  cd out && ./install.sh

zip-installer:
  #!/usr/bin/env bash
  set -euo pipefail

  cd ./out/
  zip -r9 nocturne-installer.zip .

push:
  nix run github:serokell/deploy-rs

cache:
  attic push nocturne $(nix build .#nixosConfigurations.superbird.config.system.build.toplevel --no-link --print-out-paths)

cache-qemu:
  attic push nocturne $(nix build .#nixosConfigurations.superbird-qemu.config.system.build.toplevel --no-link --print-out-paths)
