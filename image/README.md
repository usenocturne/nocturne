<h1 align="center">
  <br>
  <img src="https://usenocturne.com/images/logo.png" alt="Nocturne" width="200">
  <br>
  Nocturne
  <br>
</h1>

<p align="center">The most advanced custom firmware for the <a href="https://carthing.spotify.com" target="_blank">Spotify Car Thing</a>.</p>

<p align="center">
  <a href="#flashing">Flashing</a> •
  <a href="#donate">Donate</a> •
  <a href="#building">Building</a> •
  <a href="#subprojects">Subprojects</a> •
  <a href="#credits">Credits</a> •
  <a href="#license">License</a>
</p>

<div align="center">
  <a href="https://usenocturne.com"><img alt="Website" src="https://img.shields.io/badge/website-gray?style=flat-square&logo=react&logoColor=FFFFFF"></a>
  <a href="https://discord.gg/mnURjt3M6m"><img alt="Discord" src="https://img.shields.io/discord/1304909652387172493?style=flat-square&logo=discord&logoColor=FFFFFF&label=discord"></a>
</div>

<br>

<p align="center"><img width=600 src="https://usenocturne.com/images/nocturne.png" alt="Nocturne screenshot"></p>

## Setup

> [!WARNING]
> Bricking the Car Thing is nearly impossible, but the risk is always there when flashing custom firmware.

### Requirements

- Terbium driver is required on Windows: `irm https://driver.terbium.app/get | iex` (Powershell)

### Flashing

1. Download an installer zip file from [Releases](https://github.com/usenocturne/nocturne/releases)
2. Plug in your Car Thing's USB while holding 1+4 (buttons at the top)
3. Follow the instructions on [Terbium](https://terbium.app) to flash your Car Thing using the downloaded zip file

Flashing will likely take about 5-10 minutes, depending on your USB ports and some other factors. Please try multiple ports if one isn’t working (Rear IO USB 3/2, BIOS flash port if on AMD, etc).

### Uninstall

Use a tool of your choice (likely Terbium) to flash stock or a different firmware.

## Donate

Nocturne is a massive endeavor, and the team has spent every day over the last year making it a reality out of our passion for creating something that people like you love to use.

All donations are split between the three members of the Nocturne team and go towards the development of future features. We are so grateful for your support!

[Donation Page](https://usenocturne.com/support)

## Building

Required packages can be found in [the Buildroot user manual](https://buildroot.org/downloads/manual/manual.html#requirement). All commands should be ran as a non-root user.

Blobs from the stock Spotify OS can be fetched by running `./external/package/stock-blobs/fetch-stock.sh`. This will likely not need to be ran again unless more blobs need to be pulled from Spotify OS for future versions.

Use `./scripts/build.sh` to build a Buildroot image (a rootfs image will output to `./output/images/`). `build.sh` can take in the `package` argument (`./scripts/build.sh package`) to produce a flashable image in `./output/package/`.

The Justfile can help with some stuff, such as updating nocturne-ui (`just cleandeps && just install nocturne-ui`), updating your Nocturne install over USB (`just flash a`/b), and opening menuconfig/saving changes (`just menuconfig` and `just copyconfig` after).

```
$ just -l
Available recipes:
    clean
    cleandeps
    copyconfig
    flash slot
    flashconnector slot
    install package
    menuconfig
    wslpath
    pre-commit-install
    wslpath
```

## Subprojects

Nocturne consists of several Git repos, all of which are public and open-source.

- [nocturne-ui](https://github.com/usenocturne/nocturne-ui) - Nocturne's standalone web application written with Vite + React
- nocturned (private for legal reasons) - Local daemon for real-time web/host communication

## Credits

This software was made possible only through the following individuals and open source programs:

- [Brandon Saldan](https://github.com/brandonsaldan)
- [shadow](https://github.com/68p)
- [Dominic Frye](https://github.com/itsnebulalol)
- [bbaovanc](https://github.com/bbaovanc)

<hr>

- [JoeyEamigh/nixos-superbird](https://github.com/JoeyEamigh/nixos-superbird)
- [The Buildroot team](https://github.com/buildroot/buildroot)
- [Benjamin McGill](https://www.linkedin.com/in/benjamin-mcgill/), for providing Brandon a Car Thing
- [bishopdynamics](https://github.com/bishopdynamics), for creating the original [superbird-tool](https://github.com/bishopdynamics/superbird-tool), [superbird-debian-kiosk](https://github.com/bishopdynamics/superbird-debian-kiosk), and modifying [aml-imgpack](https://github.com/bishopdynamics/aml-imgpack)
- [Thing Labs' fork of superbird-tool](https://github.com/thinglabsoss/superbird-tool), for their contributions on the original superbird-tool

## License

This project is licensed under the **GPL-3.0** license.

We kindly ask that any modifications or distributions made outside of direct forks from this repository include attribution to the original project in the README, as we have worked hard on this. :)

This software contains calls to the Nocturne API. Any use, distribution, or modification of this software constitutes acceptance of the Nocturne API License.

---

> © 2025 Vanta Labs.

> "Spotify" and "Car Thing" are trademarks of Spotify AB. This software is not affiliated with or endorsed by Spotify AB.

> [usenocturne.com](https://usenocturne.com) &nbsp;&middot;&nbsp;
> GitHub [@usenocturne](https://github.com/usenocturne) &nbsp;&middot;&nbsp;
> [Discord](https://discord.gg/mnURjt3M6m)
