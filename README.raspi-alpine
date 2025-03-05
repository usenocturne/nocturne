# Raspberry PI Alpine Linux Image Builder

Create minimal Linux images based on [Alpine Linux](https://alpinelinux.org/)
for the [Raspberry PI](https://www.raspberrypi.org/).

## Important Changes

**04/02/25**
From alpine 3.19 the kernel names have changed so a full image must be used to upgrade as the u-boot script has changed because of this.

The default arch is now aarch64 and default RPI_FIRMWARE_BRANCH is now alpine.

## Features

* Alpine base
  * Small image size
  * Fast image build
* A/B partition schema
  * Simple update of whole system
  * Fallback if update failed
* Choice of three base image cpu types for targeting every Raspberry PI
* Read only root filesystem, with optional overlay mounted /etc
* Optional caching during build
* Boot from SD Card or USB (PI2B to PI4)
* Build is seperated into stages that can be overridden, or use custom stages/order

## Usage

> **Note:** If you want to build the image on a different architecture then the 
> destination, you can use [qemu-user-static](https://github.com/multiarch/qemu-user-static):
>
> `docker run --privileged --rm multiarch/qemu-user-static --persistent yes`
> (this is already installed if using docker desktop)

### Image Creation

> A simple example for a go application can be found in the [examples/go](examples/go) 
> directory, there is also a node-red one in [examples/node-red](examples/node-red)

To generate an empty image simply run:
```
docker run --rm -it -v $PWD/output:/output ghcr.io/raspi-alpine/builder
```

This will create 2 image files in the directory `$PWD/output/`:
* `sdcard.img.gz`: complete SD card image for the raspberry
* `sdcard_update.img.gz`: image of root partition to update running raspberry

> For each image a *.sha256 file will be generated to validate integrity.

To add custom modifications mount a script to `/input/image.sh`, or create seperate scripts in [/input/stages/60](examples/node-red/input/stages/60).
If both are used the `/input/image.sh` script is run first.
The following variables can be useful for the `image.sh` script or /input/stages/60 scripts:

| Variable    | Description                 |
| ----------- | --------------------------- |
| INPUT_PATH  | Path to input directory     |
| ROOTFS_PATH | Path to new root filesystem |
| BOOTFS_PATH | Path to new boot filesystem |
| DATAFS_PATH | Path to new data filesystem |

There is also a function `chroot_exec` that can be used to run command inside 
the new root filesystem. To enable a service called `example_daemon` simple run:
```
chroot_exec rc-update add example_daemon default
```

#### Config Variables

The following variables can be used to modify the base behaviour of the image 
builder.

| Variable                      | Default Value                                | Description                                                                                                                     |
| ----------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| ADDITIONAL_DIR_KERNEL_MODULES | none                                         | Directories in kernel modules to include all modules from, eg "w1" for one wire modules                                         |
| ADDITIONAL_KERNEL_MODULES     | none                                         | Kernel modules to keep in addition to DEFAULT_KERNEL_MODULES, so you don't have to add back the default ones                    |
| ALPINE_BRANCH                 | v3.21                                        | [Alpine Branch](https://alpinelinux.org/releases) to use for image                                                              |
| ALPINE_MIRROR                 | https://dl-cdn.alpinelinux.org/alpine        | Mirror used for package download                                                                                                |
| ARCH                          | aarch64                                      | Set to aarch64 to enable 64bit uboot and kernel (for raspberry pi 3 and 4), or armhf for pi zero and pi1 (will not boot on pi4) |
| CACHE_PATH                    | none                                         | Cache directory inside container (needs volume mounting unless in input|output path), if set firmware and apk files are cached  |
| CMDLINE                       | [resources/build.sh](resources/build.sh#L25) | Override default cmdline for kernel (needs setting in an env file not with --env, see test/simple-image for example)            |
| CUSTOM_IMAGE_SCRIPT           | image.sh                                     | Name of script for image customizations (relative to input dir), scripts in `input/stages/60` can be used instead               |
| DEFAULT_DROPBEAR_ENABLED      | true                                         | True to enable SSH server by default                                                                                            |
| DEFAULT_HOSTNAME              | alpine                                       | Default hostname                                                                                                                |
| DEFAULT_KERNEL_MODULES        | ipv6 af_packet                               | Kernel modules to keep in image                                                                                                 |
| DEFAULT_ROOT_PASSWORD         | alpine                                       | Default password for root user                                                                                                  |
| DEFAULT_SERVICES              | hostname local modules networking ntpd syslog| Services to add to default runlevel                                                                                             |
| DEFAULT_TIMEZONE              | Etc/UTC                                      | Default [Timezone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) to use for image                               |
| DEV                           | mdev                                         | Device manager to use, can be mdev or eudev                                                                                     |
| IMG_NAME                      | sdcard                                       | Base name of created image file                                                                                                 |
| INPUT_PATH                    | /input                                       | Input directory inside container                                                                                                |
| LIB_LOG                       | unset                                        | If set create /data/var/lib and /data/var/log and bind mount to /var/, also save startup log to /var/log/rc.log                 |
| OUTPUT_PATH                   | /output                                      | Output directory inside container                                                                                               |
| OVERLAY                       | unset                                        | If set then mount /etc as an overlay with /data/etc as upperdir, this makes /etc writable but changes are saved in /data/etc    |
| PI3USB                        | unset                                        | If set then `program_usb_boot_mode=1` is added to the end of `/boot/config.txt`.  See [examples/pi3-usb](examples/pi3-usb)      |
| RPI_FIRMWARE_BRANCH           | alpine                                       | [Raspberry Pi Branch](https://github.com/raspberrypi/firmware/branches) to use for firmware, 'alpine' uses alpine version       |
| RPI_FIRMWARE_GIT              | https://github.com/raspberrypi/firmware      | Raspberry Pi firmware Repo Mirror                                                                                               |
| SIZE_BOOT                     | 100M                                         | Size of boot partition                                                                                                          |
| SIZE_DATA                     | 20M                                          | Initial Size of data partition                                                                                                  |
| SIZE_ROOT_FS                  | 200M                                         | Size of root file system (0 for automatic shrink to content)                                                                    |
| SIZE_ROOT_PART                | 500M                                         | Size of root partition                                                                                                          |
| STAGES                        | 00 10 20 30 40 50 60 70 80 90                | Stages enabled for image build                                                                                                  |
| SYSINIT_SERVICES              | rngd                                         | Default services to add to sysinit runlevel                                                                                     |
| UBOOT_COUNTER_RESET_ENABLED   | true                                         | True to enable simple boot counter reset service                                                                                |
| UBOOT_PACKAGE                 | none                                         | Leave empty to use default package, or use 'silent' for uboot package without output to console or serial port                  |
| UBOOT_PROJ_ID                 | ID for raspi-alpine/crosscompile-uboot       | Project ID of another gitlab repo to use u-boot artifacts from, will download and also cache if CACHE_PATH set                  |
| UBOOT_VESRION                 | unset (latest)                               | Change which version of u-boot to use, downloaded if newer than bundled version or UBOOT_PROJ_ID is not default                 |

#### ARCH variable

Setting the ARCH variable effects which pi versions the image will run on:

|  Board          |  armhf | armv7 | aarch64 | 
| --------------- | :----: | :---: | :-----: |
| pi0             | ✅     |       |         |
| pi1             | ✅     |       |         |
| pi2             | ✅     | ✅    |         |
| pi3, pi0w2, cm3 | ✅     | ✅    | ✅      |
| pi4, pi400, cm4 |        | ✅    | ✅      |

### Kernel Modules

There are three environment variables for selecting which kernel modules to keep.

* DEFAULT_KERNEL_MODULES (Base modules, should not normally be changed unless * to keep all modules)
* ADDITIONAL_KERNEL_MODULES (Extra modules that are not in a `.conf` file for loading)
* ADDITIONAL_DIR_KERNEL_MODULES (keep all modules in subdirectory of kernel modules)

Along with these `/etc/modules` is checked, `/etc/modules-load.d` and `/usr/lib/modules-load.d`
are checked for `.conf` files.  Any modules in these files are kept as well.

#### Customization

As well as the environment variables some files change the building of the image as well.

In the INPUT_PATH if there is an m4 directory with the file hdmi.m4 this will be included instead of the default hdmi section in config.txt, to let the kernel decide hdmi settings just create a blank hdmi.m4 file.
If the INPUT_PATH m4 directory has fstab.m4, this is included at the end of the generated fstab file.

The STAGES environment variable holds the order of stages to run, if a same named file exists in the default stage directory
and the INPUT_PATH/stages/STAGE directory the INPUT_PATH one is used.  After the run of default stage scripts for that stage any
remaining scripts in INPUT_PATH/stages/STAGE are run.

**Stage script names could change when new features are added**

|          | The Current build stages are:                          |
| -------- | ------------------------------------------------------ |
| Stage 00 | Prepare root FS                                        |
| Stage 10 | Configure root FS                                      |
| Stage 20 | Configure system                                       |
| Stage 30 | Install extras                                         |
| Stage 40 | Kernel and u-boot                                      |
| Stage 50 | Configure boot FS                                      |
| Stage 60 | Running user image.sh script and user stage 60 scripts |
| Stage 70 | Pruning kernel modules                                 |
| Stage 80 | Cleanup                                                |
| Stage 90 | Create SD card image                                   |


#### Caching the build

If CACHE_PATH is set apk files and firmware are saved there, there is also commands `ab_cache` and `ab_git` which
can be used to cache files and directories or git repositories.
`ab_cache` can be used with a single command, or a script which is run if the cache archive is missing, or no command
if caching objects from a previous step.
Files can have wildards, see [examples/node-red](examples/node-red/input/stages/60/04-node-red.sh).
If a script is used and it is in the INPUT_PATH or RES_PATH a checksum is saved so the script is run again if changed.
A checksum is not saved if no command/script is given, or if the script/command is outside INPUT_PATH or RES_PATH.
In which case the the cache archive needs to be deleted to build it again.

### Update running system

The system can be updated without a complete flash of the SD card from the 
running system with the following steps:

1. Transfer the update image to the running system
2. (Optional) Validate integrity of image with checksum file
3. Write the image to the actual inactive partition
4. Switch active partition
5. Reboot system

> An example implementation can be found in the helper script 
> [ab_flash](resources/scripts/ab_flash.sh)

## Image structure

### Partition Layout

The image contains 4 partitions:

1. **Boot:** (Size: `SIZE_BOOT`) \
   Contains boot loader and boot configuration

2. **Root A:** (Size: `SIZE_ROOT_PART`) \
   Contains complete root filesystem including all required kernels

3. **Root B:** (Size: `SIZE_ROOT_PART`) \
   Same as *Root A*

4. **Data:** (Size: Initial `SIZE_DATA` & increases on first start) \
   Contains persistent data for both root partitions

> With the exception of the data partition every partition is mounted read only

The A/B root partitions enables an easy and reliable way to update the complete 
system. This is done by flashing the inactive partition with a new root 
filesystem and make this partition active. If this new filesystem does not boot
the boot loader will fallback to the old partition.

The root file system should be as small as possible to reduce the update time 
later. To support future increase of the root file system the partition should 
contain some free space.

### Boot loader

To support the A/B partition schema the [U-Boot](https://www.denx.de/wiki/U-Boot)
boot loader is used.

The configuration/script for the boot loader can be found in the 
[boot.cmd](resources/boot.cmd). This will boot the active root partition and 
switch the active partition if the active one will not start.
> This script also select the right kernel for old Raspberry PIs

The image contains a simple tool that resets the boot counter and switch the 
active partition from the running OS. The sources of the script can be found 
in the [uboot.c](https://gitlab.com/raspi-alpine/crosscompile-uboot-tool/-/blob/main/resources/uboot.c).

By default the u-boot version bundled at docker image creation is used.
The version, package, and repo the artifacts are downloaded from can be
changed with the `UBOOT_*` [config variables](#config-variables).

#### USB booting and partition labels

To enable USB boot on PI4 raspberry pi imager is used to create an SD card image
to update the bootloader: https://www.raspberrypi.com/documentation/computers/raspberry-pi.html#pi4

The Raspberry Pi 3B+ supports USB mass storage boot out of the box.

On a PI2B to PI3B if you need to enable USB booting set the `PI3USB` environment variable to Yes,
or manually add to `config.txt` in `image.sh`, or with a separate SD Card (see [examples/pi3-usb](examples/pi3-usb).
More info is here: https://www.raspberrypi.com/documentation/computers/raspberry-pi.html#raspberry-pi-2b-3a-3b-cm-3-3-zero-2-w

As to set them to usb boot an SD Card is required first, so it might be desirable to use a separate SD Card to do this.

The system will boot off SD card as a priority, but the `/data` and `/uboot` partitions are mounted by label.
So if a USB stick is present as well with a paritions labeled `data` and `BOOT`
these are likely to be mounted instead of the ones on the SD Card.
So the the partitions you do not wish to use should have the label changed, eg. with `e2label`.

### Logging
By default syslog is configured to log to the kernel printk buffer so it does
not create any log files, logs can be read with dmesg.  Which are shown
along with kernel messages.

### Matrix Room
For questions you can also join our Matrix room [#raspi-alpine:matrix.org](https://matrix.to/#/#raspi-alpine:matrix.org) from any Matrix home server.
