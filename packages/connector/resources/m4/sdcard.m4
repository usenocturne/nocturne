image sdcard.img {
  hdimage {
    disk-signature = xDISK_SIGNATURE
    align = 4M
  }
  partition boot {
    partition-type = 0xC
    image = "boot.vfat"
  }
  partition rootfs {
    partition-type = 0x83
    image = "rootfs.ext4"
    size = xSIZE_ROOT
  }
}