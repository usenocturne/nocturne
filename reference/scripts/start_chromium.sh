#!/bin/bash
# Start X with just Chromium browser
#	fullscreen, kiosk mode, tweaked for touchscreen, with given url

# handle defaults
URL="https://192.168.1.144:8123/lovelace/"
SCALE="1.0"
EXTRA_CHROMIUM_ARGS=""
EXTRA_XORG_ARGS="-nocursor"

## Hardcoded Vars
CHROMIUM_BINARY="/usr/bin/chromium"
USER_DATA_DIR="/config"
DISK_CACHE_DIR="/dev/null"  # prevent chromium from caching anything

echo "Starting chromium kiosk"

command -v "$CHROMIUM_BINARY" || {
	echo "Need to install chromium! "
	exit 1
}

/scripts/setup_display.sh

# does not get cleaned up properly after previous exit
rm ${USER_DATA_DIR}/SingletonLock

CHROMIUM_CMD="xinit $CHROMIUM_BINARY \
	--no-gpu \
	--disable-gpu \
	--no-sandbox \
	--autoplay-policy=no-user-gesture-required \
	--use-fake-ui-for-media-stream \
	--use-fake-device-for-media-stream \
	--disable-sync \
	--remote-debugging-port=9222 \
	--display=$DISPLAY \
	--force-device-scale-factor=$SCALE \
	--pull-to-refresh=1 \
	--disable-smooth-scrolling \
	--disable-login-animations \
	--disable-modal-animations \
	--noerrdialogs \
	--no-first-run \
	--disable-infobars \
	--fast \
	--fast-start \
	--disable-pinch \
	--overscroll-history-navigation=0 \
	--disable-translate \
	--disable-overlay-scrollbar \
	--disable-features=OverlayScrollbar \
	--disable-features=TranslateUI \
	--disk-cache-dir=$DISK_CACHE_DIR \
	--password-store=basic \
	--touch-events=enabled \
	--ignore-certificate-errors \
	--user-data-dir=$USER_DATA_DIR \
	--kiosk $EXTRA_CHROMIUM_ARGS \
	--app=$URL -- $EXTRA_XORG_ARGS"

echo ""
echo "running chromium command: $CHROMIUM_CMD"
echo ""
$CHROMIUM_CMD

# clear the display after chromium is killed, otherwise the last image will remain frozen
/scripts/clear_display.sh
