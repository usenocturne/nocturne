/dev/mmcblk0p2  /           ext4     ro,noload,noauto,noatime,errors=remount-ro  0 1
/dev/mmcblk0p3  /           ext4     ro,noload,noauto,noatime,errors=remount-ro  0 1
/dev/mmcblk0p4  /data       ext4     defaults            0 2
/data/root      /root       none     defaults,bind       0 0

proc            /proc       proc     defaults            0 0
sysfs           /sys        sysfs    defaults            0 0
devpts          /dev/pts    devpts   gid=4,mode=620      0 0
tmpfs           /dev/shm    tmpfs    defaults            0 0
tmpfs           /tmp        tmpfs    defaults            0 0
tmpfs           /run        tmpfs    defaults            0 0
tmpfs           /var/lock   tmpfs    defaults            0 0

ifdef(`xFSTAB', `include(xFSTAB)')
