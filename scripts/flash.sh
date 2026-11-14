#!/usr/bin/env bash
# AGNES OS 2.0 — one-command firmware flash for the ESP32-C3.
#
# Usage:
#   scripts/flash.sh                     detect port, compile, upload
#   scripts/flash.sh /dev/ttyACM0        use an explicit port
#   WAIT_SECONDS=600 scripts/flash.sh    wait up to 600 s for the board to appear
#   scripts/flash.sh --monitor           open the serial monitor after upload
#   scripts/flash.sh --erase             full-erase flash first (odd boot states)
#   scripts/flash.sh --no-compile        flash existing dist/firmware binaries
#   scripts/flash.sh --help
#
# The build always uses the Huge APP partition scheme: the image is ~1.53 MB and
# does not fit the default 1.2 MB partition.
#
# Safety: the script refuses any board that identifies as something other than
# esp32:esp32:esp32c3. esptool additionally verifies the chip over serial, so an
# AVR or other MCU can never be written by mistake.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FQBN="esp32:esp32:esp32c3:PartitionScheme=huge_app"
SKETCH="$ROOT/firmware/AGNES_OS_2_0"
OUT="$ROOT/dist/firmware"
ARDUINO="${ARDUINO_CLI:-/home/sivaraman/bin/arduino-cli}"
WAIT_SECONDS="${WAIT_SECONDS:-0}"
UPLOAD_ATTEMPTS="${UPLOAD_ATTEMPTS:-4}"

PORT=""
MONITOR=0
ERASE=0
COMPILE=1

for arg in "$@"; do
  case "$arg" in
    --monitor) MONITOR=1 ;;
    --erase) ERASE=1 ;;
    --no-compile) COMPILE=0 ;;
    -h|--help)
      sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "Unknown option: $arg (try --help)" >&2
      exit 64
      ;;
    *) PORT="$arg" ;;
  esac
done

print_not_found_help() {
  cat >&2 <<'EOF'
No serial port found. Work through this list:

  1. Use a USB *data* cable — charge-only cables never enumerate.
  2. Plug straight into the computer; avoid hubs and extension cables.
  3. Hold BOOT, tap RESET, release BOOT, then retry (forces the bootloader).
  4. Confirm the port exists:   ls /dev/ttyACM* /dev/ttyUSB*
  5. Check the kernel saw it:   lsusb
       ESP32-C3 native USB  ->  303a:1001 / 303a:1000 (Espressif)
       CH340 clone          ->  1a86:55d4
       CP210x clone         ->  10c4:ea60
  6. On Linux, add yourself to the dialout group if permission is denied:
       sudo usermod -aG dialout $USER   (then log out and back in)

An Arduino Uno (2341:0043) or any non-ESP32 board will be refused: AGNES runs
only on an ESP32-C3.
EOF
}

# Prefer a port the Arduino CLI recognises, then any USB serial device.
detect_port() {
  local p
  p=$("$ARDUINO" board list 2>/dev/null \
      | awk 'NR > 1 && $1 ~ /^\/dev\/tty(ACM|USB)/ { print $1; exit }')
  if [ -n "$p" ]; then echo "$p"; return 0; fi
  for p in /dev/serial/by-id/*; do
    if [ -e "$p" ]; then echo "$p"; return 0; fi
  done
  for p in /dev/ttyACM* /dev/ttyUSB*; do
    if [ -e "$p" ]; then echo "$p"; return 0; fi
  done
  return 1
}

# Print the FQBN the Arduino CLI reports for a port. Exit 1 if the port is not
# in the board list (identity unknown — the caller decides what that means).
# The board name and FQBN are separated by a single space, so match the first
# vendor:arch:board token anywhere on the port line rather than splitting on
# whitespace columns.
identify_fqbn() {
  "$ARDUINO" board list 2>/dev/null | python3 -c '
import re, sys
port = sys.argv[1]
token = re.compile(r"\S+:\S+:\S+")
for line in sys.stdin:
    if line.startswith("Port") or not line.strip():
        continue
    if line.split()[0] != port:
        continue
    m = token.search(line)
    if m:
        print(m.group(0))
    sys.exit(0)
sys.exit(1)
' "$1"
}

if [ -z "$PORT" ]; then
  echo "==> Looking for a connected board (waiting up to ${WAIT_SECONDS}s)..."
  deadline=$((SECONDS + WAIT_SECONDS))
  while :; do
    if PORT=$(detect_port); then
      echo "==> Found $PORT"
      break
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "ERROR: no serial port found after ${WAIT_SECONDS}s." >&2
      print_not_found_help
      exit 2
    fi
    sleep 1
  done
else
  echo "==> Using port $PORT"
fi

if [ ! -e "$PORT" ]; then
  echo "ERROR: port $PORT does not exist." >&2
  print_not_found_help
  exit 2
fi

# --- board identity guard -------------------------------------------------
DETECTED_FQBN=$(identify_fqbn "$PORT" || true)
if [ -n "$DETECTED_FQBN" ]; then
  if [ "${DETECTED_FQBN%%:*}" != "esp32" ]; then
    echo "ERROR: $PORT is not an ESP32-C3." >&2
    echo "  Detected board : $DETECTED_FQBN" >&2
    echo "  Required board : esp32:esp32:esp32c3 (ESP32-C3 Super Mini)" >&2
    echo "AGNES firmware is a 1.53 MB RISC-V image; it cannot be flashed to an" >&2
    echo "ATmega/AVR board. Unplug this board, connect the ESP32-C3, and re-run." >&2
    exit 3
  fi
  echo "==> Board identified: $DETECTED_FQBN"
else
  echo "==> Note: identity unknown for $PORT — esptool will read the chip ID"
  echo "    over serial and abort if it is not an ESP32-C3."
fi

# --- compile --------------------------------------------------------------
if [ "$COMPILE" = 1 ]; then
  echo "==> Compiling (Huge APP)..."
  "$ARDUINO" compile --fqbn "$FQBN" --output-dir "$OUT" "$SKETCH"
else
  echo "==> Skipping compile; using existing binaries in dist/firmware."
fi

if [ ! -f "$OUT/AGNES_OS_2_0.ino.bin" ]; then
  echo "ERROR: no compiled binary in $OUT (run without --no-compile)." >&2
  exit 2
fi

if [ "$ERASE" = 1 ]; then
  echo "==> Erasing flash..."
  python3 -m esptool --chip esp32c3 --port "$PORT" erase-flash \
    || python3 -m esptool --chip esp32c3 --port "$PORT" erase_flash
fi

# --- upload with re-detection --------------------------------------------
# The ESP32-C3 re-enumerates during the reset dance, so the device node can
# vanish mid-attempt. Re-detect and retry instead of failing on the first miss.
uploaded=0
for attempt in $(seq 1 "$UPLOAD_ATTEMPTS"); do
  if [ ! -e "$PORT" ]; then
    echo "==> $PORT disappeared; waiting for it to come back..."
    sleep 2
    PORT=$(detect_port) || {
      echo "ERROR: the board disconnected and did not re-enumerate." >&2
      print_not_found_help
      exit 2
    }
    echo "==> Re-detected $PORT"
  fi

  echo "==> Upload attempt $attempt/$UPLOAD_ATTEMPTS on $PORT"
  if "$ARDUINO" upload \
       --fqbn "$FQBN" \
       --port "$PORT" \
       --input-dir "$OUT" \
       "$SKETCH"; then
    uploaded=1
    break
  fi

  echo "==> Attempt $attempt failed; waiting 2 s for the port to settle..."
  sleep 2
  PORT=""   # force re-detection on the next pass
  PORT=$(detect_port || true)
done

if [ "$uploaded" != 1 ]; then
  echo "ERROR: upload failed after $UPLOAD_ATTEMPTS attempts." >&2
  echo "Checklist:" >&2
  echo "  - hold BOOT, tap RESET, release BOOT, then re-run" >&2
  echo "  - try a different USB port or cable" >&2
  echo "  - close any serial monitor holding the port" >&2
  print_not_found_help
  exit 1
fi

echo "==> Upload complete."
echo "    Project URL baked into Config.h:"
grep -m1 'AGNES_SUPABASE_URL "' "$SKETCH/src/Config.h" | sed 's/^/      /'

if [ "$MONITOR" = 1 ]; then
  echo "==> Opening serial monitor at 115200 (Ctrl-C to exit)..."
  exec "$ARDUINO" monitor --port "$PORT" --config baudrate=115200
fi
