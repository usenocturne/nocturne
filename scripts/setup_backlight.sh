#!/bin/bash
# set up the backlight by following if display is on or off

# 0 - 100, display brightness when On
BRIGHTNESS=100

# seconds, how often to check state of display
CHECK_TIME=0.1

# the backlight brightness control
BACKLIGHT="/sys/devices/platform/backlight/backlight/aml-bl/brightness"

while :;do
	DISPLAY_STATUS=$(DISPLAY=:0 xset -q|grep "Monitor is"|awk '{print $3}')
	if [ "$DISPLAY_STATUS" == "Off" ]; then
		# only turn off backlight if it actually says "Off", fallback is always on
		echo 0 > $BACKLIGHT
	else
		echo $BRIGHTNESS > $BACKLIGHT
	fi
	sleep $CHECK_TIME
done

# try to leave backlight on if the loop breaks
echo $BRIGHTNESS > $BACKLIGHT
