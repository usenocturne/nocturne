#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

make -C buildroot BR2_EXTERNAL="$ROOT/external" O="$ROOT/output" BR2_DEFCONFIG="$ROOT/configs/nocturne_defconfig" defconfig
make -C buildroot O="$ROOT/output" source
make -C buildroot O="$ROOT/output" -j"$(nproc)"

if [ "${1:-}" == "package" ]; then
    "$ROOT"/scripts/package.sh
fi
