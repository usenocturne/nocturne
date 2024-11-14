#!/usr/bin/env python3
"""
Partitions for superbird, extracted from output of: bulkcmd 'amlmmc part 1'
"""
# pylint: disable=line-too-long

# TODO we have an alternate size for data partition, but is the offset always the same?

# offset is in bytes
# size is in 512-byte sectors

SUPERBIRD_PARTITIONS = {
    'bootloader': {
        'offset': 0,
        'size': 4096,
    },
    'reserved': {
        'offset': 73728,
        'size': 131072,
    },
    'cache': {
        'offset': 221184,
        'size': 0,
    },
    'env': {
        'offset': 237568,
        'size': 16384,
    },
    'fip_a': {
        'offset': 270336,
        'size': 8192,
    },
    'fip_b': {
        'offset': 294912,
        'size': 8192,
    },
    'logo': {
        'offset': 319488,
        'size': 16384,
    },
    'dtbo_a': {
        'offset': 352256,
        'size': 8192,
    },
    'dtbo_b': {
        'offset': 376832,
        'size': 8192,
    },
    'vbmeta_a': {
        'offset': 401408,
        'size': 2048,
    },
    'vbmeta_b': {
        'offset': 419840,
        'size': 2048,
    },
    'boot_a': {
        'offset': 438272,
        'size': 32768,
    },
    'boot_b': {
        'offset': 487424,
        'size': 32768,
    },
    'system_a': {
        'offset': 536576,
        'size': 1056856,
    },
    'system_b': {
        'offset': 1609816,
        'size': 1056856,
    },
    'misc': {
        'offset': 2683056,
        'size': 16384,
    },
    'settings': {
        'offset': 2715824,
        'size': 524288,
    },
    'data': {
        'offset': 3256496,
        'size': 4378448,
        'size_alt': 4476752,  # this is the old value of the data partition size
    },
}


# output of: bulkcmd 'amlmmc part 1'

# Part      Start       Sectors  x  Size    Type    name
#  00       0           8192        512     U-Boot  bootloader
#  01       73728       131072      512     U-Boot  reserved
#  02       221184      0           512     U-Boot  cache
#  03       237568      16384       512     U-Boot  env
#  04       270336      8192        512     U-Boot  fip_a
#  05       294912      8192        512     U-Boot  fip_b
#  06       319488      16384       512     U-Boot  logo
#  07       352256      8192        512     U-Boot  dtbo_a
#  08       376832      8192        512     U-Boot  dtbo_b
#  09       401408      2048        512     U-Boot  vbmeta_a
#  10       419840      2048        512     U-Boot  vbmeta_b
#  11       438272      32768       512     U-Boot  boot_a
#  12       487424      32768       512     U-Boot  boot_b
#  13       536576      1056856     512     U-Boot  system_a
#  14       1609816     1056856     512     U-Boot  system_b
#  15       2683056     16384       512     U-Boot  misc
#  16       2715824     524288      512     U-Boot  settings
#  17       3256496     4378448     512     U-Boot  data

# on some devices, partition 17 is 4476752 sectors


# From the Kernel boot log

# [mmcblk0p01]  bootloader  offset 0x000000000000, size 0x000000400000
# [mmcblk0p02]    reserved  offset 0x000002400000, size 0x000004000000
# [mmcblk0p03]       cache  offset 0x000006c00000, size 0x000000000000
# [mmcblk0p04]         env  offset 0x000007400000, size 0x000000800000
# [mmcblk0p05]       fip_a  offset 0x000008400000, size 0x000000400000
# [mmcblk0p06]       fip_b  offset 0x000009000000, size 0x000000400000
# [mmcblk0p07]        logo  offset 0x000009c00000, size 0x000000800000
# [mmcblk0p08]      dtbo_a  offset 0x00000ac00000, size 0x000000400000
# [mmcblk0p09]      dtbo_b  offset 0x00000b800000, size 0x000000400000
# [mmcblk0p10]    vbmeta_a  offset 0x00000c400000, size 0x000000100000
# [mmcblk0p11]    vbmeta_b  offset 0x00000cd00000, size 0x000000100000
# [mmcblk0p12]      boot_a  offset 0x00000d600000, size 0x000001000000
# [mmcblk0p13]      boot_b  offset 0x00000ee00000, size 0x000001000000
# [mmcblk0p14]    system_a  offset 0x000010600000, size 0x00002040b000
# [mmcblk0p15]    system_b  offset 0x00003120b000, size 0x00002040b000
# [mmcblk0p16]        misc  offset 0x000051e16000, size 0x000000800000
# [mmcblk0p17]    settings  offset 0x000052e16000, size 0x000010000000
# [mmcblk0p18]        data  offset 0x000063616000, size 0x0000859ea000 # on some devices, size is 0x0000889ea000
