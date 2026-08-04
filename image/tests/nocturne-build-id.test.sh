#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
VALIDATOR=${SCRIPT_DIR}/../scripts/nocturne-validate-build-id

for valid in 20260725000100 00000000000000; do
  "$VALIDATOR" "$valid"
done

for invalid in '' 2026072500010 202607250001000 20260725T000100 release.1; do
  if "$VALIDATOR" "$invalid" > /dev/null 2>&1; then
    echo "accepted invalid build ID: $invalid" >&2
    exit 1
  fi
done

echo "Nocturne build ID tests passed"
