<h1 align="center">
  <br>
  <img src="https://usenocturne.com/images/logo.png" alt="Nocturne" width="200">
  <br>
  nocturne-image
  <br>
</h1>

<h4 align="center">A pre-built Alpine image for the <a href="https://carthing.spotify.com/" target="_blank">Spotify Car Thing</a>.</h4>

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

Disclaimer: Bricking the Car Thing is nearly impossible, but the risk is always there when flashing custom partition tables.

### Requirements

- libusb is required on macOS: `brew install libusb`
- Terbium driver is required on Windows: `irm https://driver.terbium.app/get | iex` (Powershell)

### Steps

1. Download an installer from [Releases](https://github.com/usenocturne/nocturne-image/releases)
2. Plug in your Car Thing's USB while holding 1+4 (buttons at the top)
3. Unzip and use `sudo ./flash.sh` (Linux/macOS) or double click `flash.bat` (Windows)

Flashing will likely take about 30 minutes depending on your USB ports and some other factors. It’ll look like it’s going fast but then will flash other stuff after. Please try multiple ports if one isn’t working (Rear IO USB 3/2, BIOS flash port if on AMD, etc).

### Uninstall
Use a tool of your choice to flash stock or a different firmware.

If it's failing, use:
__Windows__: `.\flashthing-cli.exe --unbrick`
__Linux/macOS__: `sudo ./flashthing-cli --unbrick`

## Donate

Nocturne is a massive endeavor, and the team have spent everyday over the last few months making it a reality out of our passion for creating something that people like you love to use.

All donations are split between the four members of the Nocturne team, and go towards the development of future features. We are so grateful for your support!

[Donation Page](https://usenocturne.com/donate)

## Building

Docker is required. If you are on an architecture other than arm64, qemu-user-static (`docker run --rm --privileged multiarch/qemu-user-static --reset -p yes`) is required.

Use the `Justfile`. `just run` will build the Docker image, and output the Car Thing image in `output`.

```
$ just -l
Available recipes:
  build
  copy
  lint
  run
  shell
```

## Credits

This software was made possible only through the following individuals and open source programs:

- [Brandon Saldan](https://github.com/brandonsaldan)
- [shadow](https://github.com/68p)
- [Dominic Frye](https://github.com/itsnebulalol)
- [bbaovanc](https://github.com/bbaovanc)

<br />

- [raspi-alpine/builder](https://gitlab.com/raspi-alpine/builder) (by [Benjamin Böhmke](https://gitlab.com/bboehmke) and [Duncan Bellamy](https://gitlab.com/a16bitsysop)) which is what this builder is based on
  - Nocturne's Alpine image would not be easy without raspi-alpine!
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
