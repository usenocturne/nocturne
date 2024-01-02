#!/bin/bash

# setup vnc server

LOGFILE="/var/log/vnc.log"
# To change password, run: sudo vncpasswd /scripts/vnc_passwd

while :; do
    /usr/bin/X0tigervnc -display=:0 -rfbport=5900 -rfbauth=/scripts/vnc_passwd -SecurityTypes=VncAuth > "$LOGFILE" 2>&1
done
