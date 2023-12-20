#!/bin/sh


cd /sys/devices/platform/meson-fb/graphics/fb0 || {
    echo "failed to find fb0 "
    exit 1
}

show_value() {
    echo "${1}=$(cat "$1")"
}

show_value afbc_err_cnt
show_value bits_per_pixel
show_value blank
show_value block_mode
show_value block_windows
show_value color_key
show_value console
show_value cursor
show_value dev
show_value enable_3d
show_value enable_key
show_value enable_key_onhold
show_value flush_rate
show_value free_scale
show_value free_scale_axis
show_value freescale_mode
show_value log_level
show_value log_module
show_value mode
show_value modes
show_value name
show_value order
show_value osd_afbc_format
show_value osd_afbcd
show_value osd_antiflicker
show_value osd_background_size
show_value osd_deband
show_value osd_dimm
show_value osd_display_debug
show_value osd_fps
show_value osd_hdr_mode
show_value osd_hwc_enable
show_value osd_line_n_rdma
show_value osd_plane_alpha
show_value osd_reverse
show_value osd_status
show_value osd_urgent
show_value pan
show_value reset_status
show_value rotate
show_value scale
show_value scale_axis
show_value scale_height
show_value scale_width
show_value state
show_value stride
show_value uevent
show_value ver_clone
show_value virtual_size
show_value window_axis
