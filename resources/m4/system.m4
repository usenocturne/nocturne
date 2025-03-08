flash superbird {
    pebsize = 16384
    lebsize = 15360
    numpebs = 232576
    minimum-io-unit-size = 512
    vid-header-offset = 512
    sub-page-size = 512
}

image system.img {
    flash {
    }
    flashtype = "superbird"

    partition misc {
        image = "misc.raw"
        size = 8M
    }

    partition swap {
        image = "swap.raw"
        size = 256M
    }

    partition boot_a {
        image = "boot.vfat"
        size = 64M
    }

    partition boot_b {
        image = "boot.vfat"
        size = 64M
    }

    partition system_a {
        image = "system.ext4"
        size = 1280M
    }

    partition system_b {
        image = "system.ext4"
        size = 1280M
    }

    partition data {
        image = "data.ext4"
    }
}
