#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyserial>=3.5"]
# ///
"""hold RTS deasserted so the soc reset line stays released. wiring: FT232 RTS -> reset pin, active low.

device discovery: $SUPERBIRD_UART_DEV, then /dev/serial/by-id/usb-FTDI*FT232*, then /dev/ttyUSB0.
"""
import argparse
import glob
import os
import signal
import sys
import time

import serial


def find_device() -> str:
    if env := os.environ.get("SUPERBIRD_UART_DEV"):
        return env
    candidates = sorted(glob.glob("/dev/serial/by-id/usb-FTDI*FT232*"))
    if candidates:
        return candidates[0]
    return "/dev/ttyUSB0"


def open_port(device: str) -> serial.Serial:
    return serial.Serial(device, 115200, exclusive=False)


def hold(device: str) -> None:
    ser = open_port(device)
    ser.rts = False  # pin high, reset released
    print(f"holding RTS deasserted on {device} (reset released). Ctrl-C to stop.")
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    try:
        while True:
            time.sleep(60)
    except KeyboardInterrupt:
        pass
    finally:
        try:
            ser.rts = False
        except Exception:
            pass


def pulse(device: str, duration_ms: int = 100) -> None:
    ser = open_port(device)
    ser.rts = True  # pin low, in reset
    time.sleep(duration_ms / 1000.0)
    ser.rts = False  # release
    print(f"pulsed reset for {duration_ms}ms on {device}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pulse", action="store_true", help="one-shot reset pulse, then exit")
    ap.add_argument("--duration-ms", type=int, default=100, help="pulse width (default 100ms)")
    ap.add_argument("--device", default=None, help="UART device (overrides $SUPERBIRD_UART_DEV / auto-detect)")
    args = ap.parse_args()
    device = args.device or find_device()
    if args.pulse:
        pulse(device, args.duration_ms)
    else:
        hold(device)


if __name__ == "__main__":
    main()
