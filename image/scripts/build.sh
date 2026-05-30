#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

: "${HOSTCC:=/usr/bin/gcc-15}"
: "${HOSTCXX:=/usr/bin/g++-15}"
export HOSTCC HOSTCXX

make -C buildroot BR2_EXTERNAL="$ROOT/external" O="$ROOT/output" BR2_DEFCONFIG="$ROOT/configs/nocturne_defconfig" HOSTCC="$HOSTCC" HOSTCXX="$HOSTCXX" defconfig
make -C buildroot O="$ROOT/output" HOSTCC="$HOSTCC" HOSTCXX="$HOSTCXX" source
make -C buildroot O="$ROOT/output" HOSTCC="$HOSTCC" HOSTCXX="$HOSTCXX" -j"$(nproc)"

if [ "${1:-}" == "package" ]; then
  "$ROOT"/scripts/package.sh
fi
