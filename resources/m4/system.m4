image system.img {
  hdimage {
  }

  partition system_a {
    partition-type = 0x83
    image = "system.ext4"
    size = 1536M
  }

  partition system_b {
    partition-type = 0x83
    image = "system.ext4"
    size = 1536M
  }

  partition data {
    partition-type = 0x83
    image = "data.ext4"
    size = 480M
  }
}