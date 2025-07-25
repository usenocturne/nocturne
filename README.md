<h1 align="center">
  <br>
  <img src="https://usenocturne.com/images/logo.png" alt="Nocturne" width="200">
  <br>
  nocturne-image
  <br>
</h1>

<h4 align="center">A pre-built Void Linux image for the <a href="https://carthing.spotify.com/" target="_blank">Spotify Car Thing</a>.</h4>

<p align="center">
  <a href="#flashing">Flashing</a> •
  <a href="#donate">Donate</a> •
  <a href="#building">Building</a> •
  <a href="#credits">Credits</a> •
  <a href="#license">License</a>
</p>

<br>

<img src="https://raw.githubusercontent.com/brandonsaldan/nocturne-image/refs/heads/main/pictures/nocturne-1.png" alt="screenshot">

## Flashing

> [!WARNING]
> Bricking the Car Thing is nearly impossible, but the risk is always there when flashing custom firmware.

### Requirements

- Terbium driver is required on Windows: `irm https://driver.terbium.app/get | iex` (Powershell)

### Steps

1. Download an installer zip file from [Releases](https://github.com/usenocturne/nocturne-image/releases)
2. Plug in your Car Thing's USB while holding 1+4 (buttons at the top)
3. Follow the instructions on [Terbium](https://terbium.app) to flash your Car Thing using the downloaded zip file

Flashing will likely take about 10 minutes depending on your USB ports and some other factors. Please try multiple ports if one isn’t working (Rear IO USB 3/2, BIOS flash port if on AMD, etc).

### Uninstall

Use a tool of your choice (likely Terbium) to flash stock or a different firmware.

## Donate

Nocturne is a massive endeavor, and the team have spent everyday over the last few months making it a reality out of our passion for creating something that people like you love to use.

All donations are split between the four members of the Nocturne team, and go towards the development of future features. We are so grateful for your support!

[Donation Page](https://usenocturne.com/donate)

## Building

`curl`, `zip/unzip`, `genimage`, `m4`, `xbps-install`, and `mkpasswd` binaries are required. xbps-install can be installed on any distro by using the [static binaries](https://docs.voidlinux.org/xbps/troubleshooting/static.html).

> [!CAUTION]
> Do not extract the xbps-static tar to your rootfs without being careful or else you may end up with a broken system. The following command has worked for me, but you have been warned.
> `sudo tar --no-overwrite-dir --no-same-owner --no-same-permissions -xvf xbps-static-latest.x86_64-musl.tar.xz -C /` 

If you are on an architecture other than arm64, qemu-user-static (+ binfmt, or use `docker run --rm --privileged multiarch/qemu-user-static --reset -p yes`) is required.

Use the `Justfile`. `just run` will output a flashable Car Thing image in `output`.

```
$ just -l
Available recipes:
  build
  copy
  lint
  run
  shell
```

## Enabling USB Tethering for use on Windows

The Car Thing running Nocturne can present itself as a virtual network adapter. With some configuration, you can share your internet connection to the Car Thing.

1. Connect the CarThing to your PC.
2. Open "Network Connections". Open the properties for the device that is labeled "Remote NDIS Compatible Device". (This is your Car Thing.)
3. Assign the following settings:
    * Sharing properties:
        * ✅ "Allow other network users to connect through this computer's Internet connection..."; select your primary uplink network adapter
        * ✅ "Allow other network users to control or disable the shared Internet connection..."
    * Internet Protocol Version 4 (TCP/IPv4) properties:
        * IP Address: 172.16.42.1
        * Subnet Mask: 255.255.255.0
4. Run the following commands in an elevated PowerShell terminal:
    * `$ctNic = (Get-NetAdapter -InterfaceDescription "*NDIS*")`
    * `$ctNic | Set-NetIPAddress -IPAddress 172.16.42.1 -PrefixLength 24`
    * `New-NetNat -Name "CarThing" -InternalIPInterfaceAddressPrefix 172.16.42.0/24`

**Tip:** If you get an error akin to a duplicate name being in use, you may need to identify conflicts on your system with `Get-VMSwitch`. If you do not have that command installed, you will need to get the Hyper-V optional Windows feature installed, following a reboot, with: `Get-WindowsOptionalFeature -Online | Where-Object FeatureName -like '*Hyper-V*'.

## Credits

This software was made possible only through the following individuals and open source programs:

- [Brandon Saldan](https://github.com/brandonsaldan)
- [shadow](https://github.com/68p)
- [Dominic Frye](https://github.com/itsnebulalol)
- [bbaovanc](https://github.com/bbaovanc)

<br />

- [raspi-alpine/builder](https://gitlab.com/raspi-alpine/builder) (by [Benjamin Böhmke](https://gitlab.com/bboehmke) and [Duncan Bellamy](https://gitlab.com/a16bitsysop)) which is what this builder is based on
- [JoeyEamigh/nixos-superbird](https://github.com/JoeyEamigh/nixos-superbird)
- [Benjamin McGill](https://www.linkedin.com/in/benjamin-mcgill/), for providing Brandon a Car Thing
- [bishopdynamics](https://github.com/bishopdynamics), for creating the original [superbird-tool](https://github.com/bishopdynamics/superbird-tool), [superbird-debian-kiosk](https://github.com/bishopdynamics/superbird-debian-kiosk), and modifying [aml-imgpack](https://github.com/bishopdynamics/aml-imgpack)
- [Thing Labs' fork of superbird-tool](https://github.com/thinglabsoss/superbird-tool), for their contributions on the original superbird-tool

## License

This project is licensed under the **Apache** license.

---

> © 2025 Nocturne.

> "Spotify" and "Car Thing" are trademarks of Spotify AB. This software is not affiliated with or endorsed by Spotify AB.

> [usenocturne.com](https://usenocturne.com) &nbsp;&middot;&nbsp;
> GitHub [@usenocturne](https://github.com/usenocturne)
