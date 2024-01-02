#!/bin/bash

# setup vnc server

LOGFILE="/var/log/vnc.log"
/usr/bin/x11vnc -rfbport 5900 -loop -safer -passwd "superbird" -forever -notruecolor -quiet -display ":0" -shared > "$LOGFILE" 2>&1
