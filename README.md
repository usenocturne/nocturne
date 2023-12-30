# Wall Thing: Debian Chromium Kiosk on Spotify Car Thing (superbird)

This is a prebuilt image of Debian 13 (Trixie) for the Spotify Car Thing, aka superbird.
It combines the stock kernel with a debian rootfs, and launches a fullscreen Chromium kiosk. I like to use it with Home Assistant.

<img src="pictures/superbird_ha_portrait.jpg" alt="Home Assistant on Car Thing" style="height: 300px;"/>
<img src="pictures/superbird_wall_mount.jpg" alt="Home Assistant on Car Thing" style="height: 300px;"/>


This image will remove the default Spotify functionality. You should definitely [make a full backup](https://github.com/bishopdynamics/superbird-tool) before proceeding!

Default user and password are both `superbird`

## Features

* Debian 13 (Trixie) aarch64
* Framebuffer display working with X11, in portrait or landscape, with touch input
* Networking via USB RNDIS (requires a host device)
* Automatic blacklight on/off with display wake/sleep
* Chromium remote debugging, VNC and SSH (forwarded through host device)
* Chromium browser, fullscreen kiosk mode
* Buttons and dial used to control a light and recall scenes/automations/scripts on Home Assistant

Available, but not used in this image:

* Bluetooth
* Backlight brightness control (currently fixed at 100)
* Audio (mic array, DSP)

Not working: Wifi

WiFi is technically possible on this hardware, but the stock bootloaders and kernel disable it.
It might be possible to cherry-pick the wifi information from the Radxa Zero device tree (practically the same SoC), but I think you would need to rebuild one or more of the bootloader stages to make it work.


## Boot Modes

After installation, you will have 3 different boot options, depending on what buttons are held:

* Debian Mode - default, no buttons held
  * bootlogo is Android with a checkmark
  * kernel is `boot_b` root is `data`

* Utility Mode - hold button 1
  * bootlogo is Spotify
  * kernel is `boot_a` root is `system_a`
  * adb and already configured
  * scripts to install debian

* USB Burn Mode - hold button 4
  * bootlogo is Android with exclamation mark


## Installation

Requirements:
* Spotify Car Thing
* another device to act as host, such as Radxa Zero, Rockpi S, Raspberry Pi 4, etc
* a USB cable to connect the two
* power supply for the host device
* a desktop/laptop for flashing the image to the Car Thing


Setup:
1. Download and extract the image from [Releases](https://github.com/bishopdynamics/superbird-debian-kiosk/releases)
2. Put your device in burn mode by holding buttons 1 & 4 while plugging into usb port
   1. avoid using a USB hub, you will have issues flashing the image
3. Use the latest version of [superbird-tool](https://github.com/bishopdynamics/superbird-tool) to flash the extracted image folder:

```bash
# root may be needed, check superbird-tool readme for platform-specific usage
# make sure your device is found
python3 superbird_tool.py --find_device
# restore the entire folder to your device
python3 superbird_tool.py --restore_device ~/Downloads/debian_v1.2_2023-12-19
```

4. Configure a host system
   1. Select a host device. I have tested:
      1. [Radxa Zero](pictures/superbird_wall_mount.jpg) with [Armbian](https://www.armbian.com/radxa-zero/) Jammy Minimal CLI
         1. The Armbian Bookworm release did not work with USB burn mode, but works fine as a host just for networking
      2. [Radxa Rockpi S](pictures/superbird_landscape_back.jpg) ([with a PoE hat!](pictures/superbird_poe.jpg)), also with Armbian Jammy
      3. Raspberry Pi 4B, with Raspi OS Bookworm Lite
   2. Copy and run `setup_host.sh` on the host device (as root), and reboot
   3. Connect the Car Thing into the host device and power it up
5. ssh to the host device, and then you should be able to ssh to the Car Thing (user and password are both `superbird`) :
```bash
# the script added an entry in /etc/hosts, so you can use hostname "superbird" from the host device
ssh superbird@superbird
# or by ip (host device is 192.168.7.1, superbird is 192.168.7.2)
ssh superbird@192.168.7.2
```
1. From another device on the same network, you should be able to ssh directly to the Car Thing using port 2022:
```bash
# where "host-device" is the hostname or ip of your host device
ssh -p 2022 superbird@host-device
```
1. Once you have ssh access to the Car Thing, edit some things:
   1. Probably change password
   2. Edit `/scripts/chromium_settings.sh` to change what URL to launch in the kiosk
      1. Restart X11 and Chromium with: `sudo systemctl restart chromium.service`
   3. Edit `/scripts/buttons_settings.py` to change Home Assistant URL and add long-lived token for access
      1. assign scenes/automations/scripts to buttons, assign a light entity to the knob
      2. Restart buttons script with: `sudo systemctl restart buttons.service`
   4. Edit `/etc/X11/xorg.conf` to adjust screen timeout (default 10 mins), orientation (default portrait)
      1. for landscape, un-comment lines `38` and `71`
   5. Edit `/scripts/setup_display.sh` and `/scripts/setup_backlight.sh` to adjust backlight brightness (default 100)
      1. Restart backlight script with: `sudo systemctl restart backlight.service`
   6. Edit `/scripts/setup_vnc.sh` to adjust VNC server settings and password
      1. Restart vnc script with: `sudo systemctl restart vnc.service`
2. Using your favorite VNC client, connect by VNC to the host device's address, port 5900, if you need to interact with a page (sign in)
3. ?
4.  Profit


## How I Created the Final Image

All the scripts and resources I used are in `reference/`, see that [Readme](reference/Readme.md) for more details.

Here are the general steps:

1. using [superbird-tool](https://github.com/bishopdynamics/superbird-tool), dump the entire device
2. mount `system_b.ext2` (use this for Utility Mode)
   1. install usb gadget, so we can use ADB to get a shell
   2. install debootstrap, so we can manually rebuild the rootfs on-device if desired
      1. place `install_debian.sh` in `/scripts/`
   3. modify `/etc/fstab` and `/etc/inittab` to not use `data` partition (see `reference/etc/`)
   4. grab `/lib/modules/` to be used with next step
3. use `install_debian.sh` to create a debian rootfs on `data.ext4`
   1. `install_debian.sh data.ext4`
4. use superbird-tool to write `reference/env/env_switchable.txt` to superbird env
5. use superbird-tool to write the modified versions of `system_a.ext2`, `system_b.ext2`, and `data.ext4`
6. test and tweak
7. use superbird-tool to do a full device dump

## Warranty and Liability

None. You definitely can mess up your device in ways that are difficult to recover. I cannot promise a bug in this script will not brick your device.
By using this tool, you accept responsibility for the outcome. 

I highly recommend connecting to the UART console, [frederic's repo](https://github.com/frederic/superbird-bulkcmd) has some good pictures showing where the pads are.

Make backups.
