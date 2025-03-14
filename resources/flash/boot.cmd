# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
# static config
# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
setenv boot_partition_a 0x02
setenv boot_partition_b 0x03
setenv boot_limit 0x02

setenv addr_version 0x10000
setenv addr_boot_counter 0x10001
setenv addr_boot_partition 0x10002


# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
# load persistence values
# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
mw.b 0x10000 0 0x404

# load saved boot data file /uboot/uboot.dat
fatload mmc 2:1 0x10000 uboot.dat 0x400

# check CRC
crc32 0x10000 0x3FC 0x10400
if itest *0x103FC -ne *0x10400; then 
  echo "invalid CRC -> fallback to default values"

  # default values
  mw.b ${addr_version} 0x01
  mw.b ${addr_boot_counter} 0x00
  mw.b ${addr_boot_partition} ${boot_partition_a}
fi

setexpr.b boot_counter *${addr_boot_counter}
setexpr.b boot_partition *${addr_boot_partition}
echo "> boot counter:   ${boot_counter}"
echo "> boot partition: ${boot_partition}"

# ensure boot partition is valid
if itest.b *${addr_boot_partition} -ne ${boot_partition_a} && itest.b *${addr_boot_partition} -ne ${boot_partition_b}; then
  echo "switched to valid partition -> A"
  mw.b ${addr_boot_partition} ${boot_partition_a}
fi


# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
# fallback boot
# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
echo "Check fallback boot"

# switch boot partition if boot count exceed limit
if itest.b *${addr_boot_counter} -ge ${boot_limit}; then
  echo "!!! Boot limit exceed !!!"

  if itest.b *${addr_boot_partition} -eq ${boot_partition_a}; then
    mw.b ${addr_boot_partition} ${boot_partition_b}
  else
    mw.b ${addr_boot_partition} ${boot_partition_a}
  fi
  mw.b ${addr_boot_counter} 0

  setexpr.b boot_partition *${addr_boot_partition}
  echo "Switch active partition to ${boot_partition}"
else
  # increase boot_count
  setexpr.b tmp *${addr_boot_counter} + 1
  mw.b ${addr_boot_counter} ${tmp}

  setexpr.b boot_partition *${addr_boot_partition}
fi


# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
# store persistence values
# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
# overwrite version
mw.b 0x10000 0x01

# calculate crc
crc32 0x10000 0x3FC 0x103FC

# save boot data to /uboot/uboot.dat
fatwrite mmc 2:1 0x10000 uboot.dat 0x400


# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
# boot
# # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
setenv bootargs "init=/sbin/init root=/dev/mmcblk0p2 ro rootwait rootfstype=ext4 ramoops.pstore_en=1 ramoops.record_size=0x8000 ramoops.console_size=0x4000 console=ttyS0,115200n8 no_console_suspend earlycon=aml-uart,0xff803000 logo=osd0,loaded,0x1f800000 fb_width=480 fb_height=800 vout=panel,enable panel_type=lcd_8 frac_rate_policy=1 osd_reverse=0 video_reverse=0 irq_check_en=0 uboot_version=mainline"
setexpr bootargs sub " root=[^ ]+" " root=/dev/mmcblk0p${boot_partition}" "${bootargs}"

ext4load mmc 2:${boot_partition} 0x1000000 /boot/superbird.dtb
ext4load mmc 2:${boot_partition} 0x1080000 /boot/Image

booti 0x1080000 - 0x1000000

sleep 3
reset
