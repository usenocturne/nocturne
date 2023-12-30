#!/bin/bash
# set up display mode

# by default portrait orientation (rotate in xorg.conf):
#   width: 480
#   height: 800
#   depth: 32 bits

FB="fb0"

WIDTH="480"
HEIGHT="800"
DEPTH="32"  # mandatory 32bit

# set the framebuffer geometry and bit depth
fbset -fb /dev/${FB} -g "$WIDTH" "$HEIGHT" "$WIDTH" "$HEIGHT" "$DEPTH"

# clear scaling values
echo 0 > /sys/class/graphics/$FB/free_scale
echo 1 > /sys/class/graphics/$FB/freescale_mode

# scaling values are always N - 1, where N is the value you actually want
# under normal conditions these two lines should match numbers
#   but if you need to scale things, adjust free_scale_axis to compensate
#   but keep window_axis as-is
echo 0 0 479 799 > /sys/class/graphics/$FB/free_scale_axis
echo 0 0 479 799 > /sys/class/graphics/$FB/window_axis

# this seems to "apply" the values set above
echo 0x10001 > /sys/class/graphics/$FB/free_scale

# make sure backlight is on
echo 100 > /sys/devices/platform/backlight/backlight/aml-bl/brightness
