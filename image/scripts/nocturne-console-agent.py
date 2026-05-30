#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyserial>=3.5"]
# ///
"""long-lived uart agent. one pyserial handle, rts=False so opening doesn't pulse reset.

reads uart bytes into a log file; forwards bytes from a fifo to uart. clients echo to the fifo.

device discovery: $SUPERBIRD_UART_DEV, then /dev/serial/by-id/usb-FTDI*FT232*, then /dev/ttyUSB0.
"""
import argparse
import glob
import os
import signal
import sys
import threading
import time

import serial


def find_device() -> str:
    if env := os.environ.get("SUPERBIRD_UART_DEV"):
        return env
    candidates = sorted(glob.glob("/dev/serial/by-id/usb-FTDI*FT232*"))
    if candidates:
        return candidates[0]
    return "/dev/ttyUSB0"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--log", required=True, help="append UART output to this file")
    ap.add_argument("--input", required=True, help="FIFO path; bytes written to it go to UART")
    ap.add_argument("--device", default=None)
    args = ap.parse_args()

    device = args.device or find_device()

    try:
        os.unlink(args.input)
    except FileNotFoundError:
        pass
    os.mkfifo(args.input, 0o600)

    ser = serial.Serial(device, 115200, exclusive=False, timeout=0.1)
    ser.rts = False

    log = open(args.log, "ab", buffering=0)
    log.write(f"--- agent started pid={os.getpid()} dev={device} ---\n".encode())

    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())

    def reader() -> None:
        while not stop.is_set():
            data = ser.read(4096)
            if data:
                log.write(data)

    def writer() -> None:
        # pace 16-char bursts; FT232 + meson 64-byte rx fifo drops chars without flow control.
        while not stop.is_set():
            try:
                fd = os.open(args.input, os.O_RDONLY)
            except OSError:
                time.sleep(0.1)
                continue
            try:
                while True:
                    chunk = os.read(fd, 4096)
                    if not chunk:
                        break
                    for i in range(0, len(chunk), 16):
                        ser.write(chunk[i:i + 16])
                        ser.flush()
                        time.sleep(0.02)
            finally:
                os.close(fd)

    threading.Thread(target=reader, daemon=True).start()
    threading.Thread(target=writer, daemon=True).start()

    try:
        while not stop.is_set():
            time.sleep(0.5)
    finally:
        stop.set()
        log.write(b"--- agent stopped ---\n")
        log.close()
        try:
            os.unlink(args.input)
        except FileNotFoundError:
            pass


if __name__ == "__main__":
    main()
