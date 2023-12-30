#!/bin/bash
# clear the display

FB="fb0"
echo 1 > /sys/class/graphics/$FB/osd_clear
