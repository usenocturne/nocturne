#!/usr/bin/env bash
# exit amlogic mask-rom usb mode and cold-boot the on-disk image. ram-staged u-boot
# resets; an rts pulse via the ftdi serial is the fallback path.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLASHTHING="${FLASHTHING_CLI:-flashthing-cli}"
RESET="${SUPERBIRD_RESET_HOLD:-$SCRIPT_DIR/nocturne-reset-hold.py}"

if ! command -v "$FLASHTHING" > /dev/null 2>&1; then
  echo "flashthing-cli not on PATH; cargo install flashthing-cli or set FLASHTHING_CLI" >&2
  exit 2
fi

"$FLASHTHING" --bulkcmd "reset" || true

"$RESET" --pulse --duration-ms 200 > /dev/null 2>&1 || true
echo "boot-kernel issued. watch UART."
