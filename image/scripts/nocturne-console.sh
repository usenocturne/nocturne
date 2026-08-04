#!/usr/bin/env bash
# start/stop/restart the uart console agent. uses a pid file so we don't pkill our own shell.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT="${SUPERBIRD_AGENT:-$SCRIPT_DIR/nocturne-console-agent.py}"
LOG=/tmp/nocturne-console.log
IN=/tmp/nocturne-console.in
PID=/tmp/nocturne-console.pid
OUT=/tmp/superbird-agent.stdout

# Resolve a /dev/ttyUSB* matching the FT232 we'll be using, just for fuser cleanup.
resolve_dev() {
  if [[ -n "${SUPERBIRD_UART_DEV:-}" ]]; then
    readlink -f "$SUPERBIRD_UART_DEV"
    return
  fi
  local candidate d=""
  for candidate in /dev/serial/by-id/usb-FTDI*FT232*; do
    [[ -e "$candidate" ]] || continue
    d="$candidate"
    break
  done
  if [[ -n "$d" ]]; then
    readlink -f "$d"
  else
    echo "/dev/ttyUSB0"
  fi
}

stop() {
  if [[ -f "$PID" ]]; then
    kill "$(cat "$PID")" 2> /dev/null || true
    sleep 1
    rm -f "$PID"
  fi
  local dev
  dev=$(resolve_dev)
  fuser -k -TERM "$dev" 2> /dev/null || true
  sleep 1
}

start() {
  if [[ -f "$PID" ]] && kill -0 "$(cat "$PID")" 2> /dev/null; then
    echo "already running: $(cat "$PID")"
    return
  fi
  rm -f "$LOG"
  nohup "$AGENT" --log "$LOG" --input "$IN" > "$OUT" 2>&1 &
  echo $! > "$PID"
  disown
  sleep 2
  if ! kill -0 "$(cat "$PID")" 2> /dev/null; then
    echo "agent failed to stay up" >&2
    cat "$OUT" >&2
    return 1
  fi
  echo "started pid=$(cat "$PID")"
}

case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  restart)
    stop
    start
    ;;
  status)
    if [[ -f "$PID" ]] && kill -0 "$(cat "$PID")" 2> /dev/null; then
      echo "running pid=$(cat "$PID")"
    else
      echo "not running"
    fi
    ;;
  *)
    echo "usage: $0 {start|stop|restart|status}" >&2
    exit 2
    ;;
esac
