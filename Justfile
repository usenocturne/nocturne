build:
  nix build '.#nixosConfigurations.superbird.config.system.build.installer' -j"$(nproc)" --show-trace

build-system:
  nix build '.#nixosConfigurations.superbird.config.system.build.toplevel' -j"$(nproc)" --show-trace

zip-system:
  #!/usr/bin/env bash
  set -euo pipefail
  dir=$(pwd)

  just build-system
  mkdir -p out
  rm -f out/system.zip
  cd result
  zip -r9 $dir/out/system.zip .

  echo "system is $(stat -Lc%s -- $dir/out/system.zip | numfmt --to=iec)"

installer:
  #!/usr/bin/env bash
  set -euo pipefail

  nix build '.#nixosConfigurations.superbird.config.system.build.installer' -j"$(nproc)" --show-trace
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

# TODO: use normal images
docker-installer:
  docker run --privileged --rm -it -v ./:/workdir -v nix-store:/nix -v nix-root:/root d10dcb4a9a66

docker-cache:
  docker run --privileged --rm -it -v ./:/workdir -v nix-store:/nix -v nix-root:/root d10dcb4a9a66 /usr/bin/env bash -c "just cache"

docker-cache-qemu:
  docker run --privileged --rm -it -v ./:/workdir -v nix-store:/nix -v nix-root:/root d10dcb4a9a66 /usr/bin/env bash -c "just cache-qemu"

docker-zip-system:
  docker run --privileged --rm -it -v ./:/workdir -v nix-store:/nix -v nix-root:/root d10dcb4a9a66 /usr/bin/env bash -c "just zip-system"
