#!/usr/bin/env bash
set -euo pipefail

root=$(git rev-parse --show-toplevel)

if [ ! -f "$root"/qemu/kernel ] || [ ! -f "$root"/qemu/emmc.img ]; then
  echo "you must run qemu-install.sh before running this script."
  exit 1
fi

qemu-system-aarch64 \
  -machine virt -cpu cortex-a53 -m 2048 -smp 4 \
  -serial stdio -device VGA \
  -kernel "$root"/qemu/kernel \
  -append "boot.debugtrace rootwait rootflags=subvol=/root root=/dev/vda2 rootfstype=btrfs swiotlb=512" \
  -drive file="$root"/qemu/emmc.img,if=virtio \
  -accel tcg
