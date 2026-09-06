<h1 align="center">
  <br>
  <img src="https://usenocturne.com/images/logo.png" alt="Nocturne" width="200">
  <br>
  Nocturne UI
  <br>
</h1>

<p align="center">Nocturne's standalone web application built with Vite + React</p>

<p align="center">
  <a href="#how-to-use">How To Use</a> •
  <a href="#development">Development</a> •
  <a href="#contributing">Contributing</a> •
  <a href="#donate">Donate</a> •
  <a href="#credits">Credits</a> •
  <a href="#related">Related</a> •
  <a href="#license">License</a>
</p>

<div align="center">
  <a href="https://usenocturne.com"><img alt="Website" src="https://img.shields.io/badge/website-gray?style=flat-square&logo=react&logoColor=FFFFFF"></a>
  <a href="https://discord.gg/mnURjt3M6m"><img alt="Discord" src="https://img.shields.io/discord/1304909652387172493?style=flat-square&logo=discord&logoColor=FFFFFF&label=discord"></a>
</div>

<br>

<p align="center"><img width=600 src="https://usenocturne.com/images/nocturne-2.png" alt="Nocturne screenshot"></p>

## How To Use

### Flashing

The guide to flash Nocturne to your Car Thing is on the [main Nocturne GitHub page](https://github.com/usenocturne/nocturne#flashing).

### Login

1. Download the mobile app for your platform [here](https://usenocturne.com/app) (paid), or use [Nocturne Connector](https://github.com/usenocturne/nocturne-connector).
2. Follow the steps in the setup wizard, and start using Nocturne!

> [!NOTE]  
> When connecting to Spotify, you may notice the app appears as 'Spotify for Desktop' - this is expected behavior and won't affect functionality.

### Presets

- Hold one of the top hardware preset buttons while viewing a playlist to map it to that button
- Press a mapped preset button anytime to instantly start playback

### Controls

- Turn the dial in the Now Playing tab to adjust volume
- Press the right-most top hardware button to lock the screen
- Hold the right-most top hardware button to open the quick settings menu

### Playback

- Tap the progress bar to scrub tracks, then turn the dial to seek and press the dial to confirm
- Swipe left or right in the Now Playing tab to skip between tracks

### Voice

- Say "Hey Nocturne", then speak to control your music hands-free (requires mobile app and Nocturne+)

## Development

1. Clone the repository:

```bash
git clone https://github.com/usenocturne/nocturne.git
cd nocturne/packages/ui
```

2. Install dependencies:

```bash
bun install
```

3. Run the local dev server

```bash
bun dev
```

### Displaying your local changes on the Car Thing

Build the bundle from the monorepo root, then use the image helper to copy it to the running kiosk:

```bash
just ui-build
just -f image/Justfile push-webapp ../packages/ui/dist ui
ssh root@nocturne.local 'systemctl restart chromium-kiosk.service'
```

The daemon serves the installed bundle from `/opt/nocturne/webapps/ui`. The image uses systemd; no rootfs remount or supervisor configuration is needed.

## Contributing

1. Fork the repository
   - Your changes should be based off the `main` branch.
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Commit your changes: `git commit -m 'chore/feat/fix: add new feature'`
   - Please label your commits with chore, feat, fix, and optionally add which module you changed in parenthesis and a short description of the change (i.e. `chore(ui): add new button`).
4. Push to the branch: `git push origin feature/new-feature`
5. Open a Pull Request

## Donate

Nocturne is a massive endeavor, and the team has spent every day over the last year making it a reality out of our passion for creating something that people like you love to use.

All donations are split between the three members of the Nocturne team and go towards the development of future features. We are so grateful for your support!

[Donation Page](https://usenocturne.com/donate)

## Credits

This software was made possible only through the following individuals and open source programs:

- [Brandon Saldan](https://github.com/brandonsaldan)
- [Neel Patel](https://github.com/68p)
- [Dominic Frye](https://github.com/itsnebulalol)
- [bbaovanc](https://github.com/bbaovanc)

<hr>

- [Benjamin McGill](https://www.linkedin.com/in/benjamin-mcgill/), for giving Brandon a Car Thing to develop with
- [bishopdynamics](https://github.com/bishopdynamics), for creating the original [superbird-tool](https://github.com/bishopdynamics/superbird-tool), and [superbird-debian-kiosk](https://github.com/bishopdynamics/superbird-debian-kiosk)
- [Thing Labs's fork of superbird-tool](https://github.com/thinglabsoss/superbird-tool), for their contributions on the original superbird-tool

## Related

- [nocturne](https://github.com/usenocturne/nocturne)
- [nocturned](../../crates/daemon) - In-tree daemon for real-time web/host communication

## License

This project is licensed under the **GPL-3.0** license.

We kindly ask that any modifications or distributions made outside of direct forks from this repository include attribution to the original project in the README, as we have worked hard on this. :)

This software contains calls to the Nocturne API. Any use, distribution, or modification of this software constitutes acceptance of the Nocturne API License.

---

> © 2026 Vanta Labs.

> "Spotify" and "Car Thing" are trademarks of Spotify AB. This software is not affiliated with or endorsed by Spotify AB.

> [usenocturne.com](https://usenocturne.com) &nbsp;&middot;&nbsp;
> GitHub [@usenocturne](https://github.com/usenocturne) &nbsp;&middot;&nbsp;
> [Discord](https://discord.gg/mnURjt3M6m)
