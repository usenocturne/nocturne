<h1 align="center">
  <br>
  <img src="https://usenocturne.com/images/logo.png" alt="Nocturne" width="200">
  <br>
  Nocturne Connector
  <br>
</h1>

<p align="center">Raspberry Pi OS for Wi-Fi connectivity on the Spotify Car Thing</p>

<p align="center">
  <a href="#prerequisites">Prerequisites</a> •
  <a href="#usage">Usage</a> •
  <a href="#donate">Donate</a> •
  <a href="#building">Building</a> •
  <a href="#tinkering-advanced">Tinkering (Advanced)</a> •
  <a href="#credits">Credits</a> •
  <a href="#license">License</a>
</p>

<div align="center">
  <a href="https://usenocturne.com"><img alt="Website" src="https://img.shields.io/badge/website-gray?style=flat-square&logo=react&logoColor=FFFFFF"></a>
  <a href="https://discord.gg/mnURjt3M6m"><img alt="Discord" src="https://img.shields.io/discord/1304909652387172493?style=flat-square&logo=discord&logoColor=FFFFFF&label=discord"></a>
</div>

## Prerequisites

- Raspberry Pi with networking
  - Pi 1 and 2 are not supported due to the lack of onboard Wi-Fi
  - Pi Zero 1 (W) is not supported due to the old architecture
- SD card
  - Nocturne Connector is super small (~60 MB), so you have many choices for SD cards
- Working Wi-Fi network
- Car Thing with Nocturne 4.0.0 or later installed

## Usage

1. Download the [img.gz from the latest release](https://github.com/usenocturne/nocturne-connector/releases/latest)
2. Use [Raspberry Pi Imager](https://www.raspberrypi.com/software/), [balenaEtcher](https://etcher.balena.io/), or dd to flash the image to your SD card
    - In Raspberry Pi Imager, click "OS" on the left side and use "Use custom", select your SD card, and press write.
4. If you are using Wi-Fi, download [wpa_supplicant.conf](https://raw.githubusercontent.com/usenocturne/nocturne-connector/refs/heads/main/README.md), and fill in your SSID and password (inside of quotes). Then, place it on the root of the SD card.
    - If your country is not the United States, replace the `US` in the file with your country code.
4. Power the Raspberry Pi & visit `nocturne-connector.local` in any browser.
    - If this does not work, You will need to find the IP address of the Raspberry Pi from your router, and use that IP address instead of `nocturne-connector.local`. 
5. Finish setting up Nocturne Connector by following the steps on screen. 

## Donate

Nocturne is a massive endeavor, and the team has spent every day over the last year making it a reality out of our passion for creating something that people like you love to use.

All donations are split between the three members of the Nocturne team and go towards the development of future features. We are so grateful for your support!

[Donation Page](https://usenocturne.com/donate)

## Building

`curl`, `zip/unzip`, `genimage`, `mkpasswd`, and `m4` binaries are required.

If you are on an architecture other than arm64, qemu-user-static and binfmt (or use `docker run --rm --privileged multiarch/qemu-user-static --reset -p yes`) are required.

Use the `Justfile`. `just run` will output a flashable `img.gz` in `output`.

```
$ just -l
Available recipes:
  connector-api
  docker-qemu
  lint
  run
```

## Tinkering (Advanced)

UART (with a TTY) is enabled and is the recommended way to debug and interact with the system. SSH is open on port 22 if you'd like instead. Root password is `nocturne`.

## Credits

This software was made possible only through the following individuals and open source programs:

- [Dominic Frye](https://github.com/itsnebulalol)
- [Neel Patel](https://github.com/68p)

### Image

- [gitlab.com/raspi-alpine/builder](https://gitlab.com/raspi-alpine/builder)

## License

This project is licensed under the **Apache** license.

---

> © 2026 Vanta Labs.

> "Spotify" and "Car Thing" are trademarks of Spotify AB. This software is not affiliated with or endorsed by Spotify AB.

> [usenocturne.com](https://usenocturne.com) &nbsp;&middot;&nbsp;
> [GitHub](https://github.com/usenocturne) &nbsp;&middot;&nbsp;
> [Discord](https://discord.gg/mnURjt3M6m)
