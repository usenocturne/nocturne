#!/bin/bash
# Start X with just Chromium browser
#	fullscreen, kiosk mode, tweaked for touchscreen, with given url

# handle defaults
# URL="https://192.168.1.144:8123/lovelace/"
# SCALE="1.0"
# EXTRA_CHROMIUM_ARGS=""
# EXTRA_XORG_ARGS="-nocursor"

source /scripts/chromium_settings.sh

## Hardcoded Vars you dont need to mess with
CHROMIUM_BINARY="/usr/bin/chromium"
USER_DATA_DIR="/config"
DISK_CACHE_DIR="/dev/null"  # prevent chromium from caching anything

# log this script's actions to a file
exec 1>/var/log/chromium.log 2>&1

echo "Starting chromium kiosk"

command -v "$CHROMIUM_BINARY" >/dev/null || {
	echo "Need to install chromium! "
	exit 1
}

/scripts/setup_display.sh

# does not get cleaned up properly after previous exit
rm ${USER_DATA_DIR}/SingletonLock

# get current resolution so we can match it
#	if you don't set --window-size, chromium will go almost-fullscreen, about 10px shy on all sides
#	if you don't set --window-position, chromium will start at about 10,10 instead of 0,0
#	why does chromium do this??!?!
# here we detect resolution by briefly starting X11 and then parsing output of xrandr
#	this is simpler and more reliable than parsing xorg.conf
#	by avoiding a hardcoded resolution here, we only need to make changes in xorg.conf if we want to change resolution or rotate

echo "Briefly starting X11 in order to detect configured resolution"
DISP_REZ=$(xinit /usr/bin/xrandr 2>/dev/null|grep "\*"|awk '{print $1}'|tr 'x' ',')
echo "Detected resolution: $DISP_REZ"

CHROMIUM_CMD="xinit $CHROMIUM_BINARY \
	--no-gpu \
	--disable-gpu \
	--no-sandbox \
	--autoplay-policy=no-user-gesture-required \
	--use-fake-ui-for-media-stream \
	--use-fake-device-for-media-stream \
	--disable-sync \
	--remote-debugging-port=9222 \
	--window-size=$DISP_REZ \
	--window-position=0,0 \
	--force-device-scale-factor=$SCALE \
	--pull-to-refresh=0 \
	--disable-smooth-scrolling \
	--disable-login-animations \
	--disable-modal-animations \
	--noerrdialogs \
	--no-first-run \
	--disable-infobars \
	--fast \
	--fast-start \
	--disable-pinch \
	--disable-translate \
	--overscroll-history-navigation=0 \ 
	--hide-scrollbars \
	--disable-overlay-scrollbar \
	--disable-features=OverlayScrollbar \
	--disable-features=TranslateUI \
	--disable-features=TouchpadOverscrollHistoryNavigation,OverscrollHistoryNavigation \
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
