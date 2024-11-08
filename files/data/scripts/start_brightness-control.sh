#!/bin/bash
# start the buttons monitoring service

export DISPLAY=:0
/usr/bin/python3 /scripts/brightness-control.py
