#!/usr/bin/env bash
set -euo pipefail

root=$(git rev-parse --show-toplevel)

if [ ! -f "$root"/qemu/emmc.img ]; then
  qemu-img create -f qcow2 "$root"/qemu/emmc.img 4G
fi

if [ ! -f "$root"/qemu/kernel ]; then
  nix build '.#nixosConfigurations.superbird-qemu.config.system.build.toplevel' --show-trace -j"$(nproc)"
  cp result/kernel "$root"/qemu
fi

if [ ! -f "$root"/qemu/btrfs.img ]; then
  nix build '.#nixosConfigurations.superbird-qemu.config.system.build.btrfs' --show-trace -j"$(nproc)"
  cp result "$root"/qemu/btrfs.img
fi

if [ ! -f "$root"/qemu/initrd.img ]; then
  nix build '.#nixosConfigurations.superbird-qemu.config.system.build.initrd' --show-trace -j"$(nproc)"
  cp result/initrd.img "$root"/qemu/initrd.img
fi

sudo qemu-system-aarch64 \
  -machine virt -cpu cortex-a53 -m 2048 -smp 4 \
  -serial stdio -device VGA \
  -kernel "$root"/qemu/kernel \
  -append "rdinit=/superbird/init superbird.qemu superbird.partition" \
  -initrd "$root"/qemu/initrd.img \
  -drive file="$root"/qemu/emmc.img,if=virtio \
  -drive file="$root"/qemu/btrfs.img,if=virtio,format=raw \
  -accel tcg
