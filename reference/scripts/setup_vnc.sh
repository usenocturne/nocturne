#!/bin/bash

# setup vnc server

LOGFILE="/var/log/vnc.log"
/usr/bin/x11vnc -rfbport 5900 -safer -passwd "superbird" -forever -quiet -scale 1 -display ":0" -shared -geometry "480x800" > "$LOGFILE" 2>&1
