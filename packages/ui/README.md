<h1 align="center">
  <br>
  <img src="https://usenocturne.com/images/logo.png" alt="Nocturne" width="200">
  <br>
  Nocturne UI
  <br>
</h1>

<h4 align="center">A web application for <a href="https://github.com/usenocturne/nocturne-image" target="_blank">nocturne-image</a> and the <a href="https://carthing.spotify.com/" target="_blank">Spotify Car Thing</a>.</h4>

<p align="center">
  <a href="#how-to-use">How To Use</a> •
  <a href="#local-development-setup">Local Development Setup</a> •
  <a href="#contributing">Contributing</a> •
  <a href="#donate">Donate</a> •
  <a href="#credits">Credits</a> •
  <a href="#related">Related</a> •
  <a href="#license">License</a>
</p>

<br>
<img src="https://raw.githubusercontent.com/brandonsaldan/nocturne-image/refs/heads/main/pictures/nocturne-1.png" alt="screenshot">
<br>
<img src="https://raw.githubusercontent.com/brandonsaldan/nocturne-image/refs/heads/main/pictures/nocturne-2.png" alt="screenshot">
<br>
<img src="https://raw.githubusercontent.com/brandonsaldan/nocturne-image/refs/heads/main/pictures/nocturne-3.png" alt="screenshot">

## How To Use

### Login

1. Follow the steps for your operating system in <a href="https://github.com/usenocturne/nocturne-image?tab=readme-ov-file#how-to-use">the image's repo</a>.
2. Once running on your Car Thing, scan the QR Code using your phone's camera.
3. Authorize with Spotify and start using Nocturne!

> [!NOTE]  
> When connecting to Spotify, you may notice the app appears as 'Spotify for Desktop' - this is expected behavior and won't affect functionality.

### Button Mapping and Button Usage

- Hold one of the top hardware preset buttons while on a playlist page to map it to the button
- Press the mapped buttons to quickly play playlists
- Hold the right-most top hardware button to access settings
- Triple-press the right-most top hardware button to access brightness control
- Press the hardware button underneath of the knob to go back in the application

## Local Development Setup

First, set up the configuration:

1. Clone the repository:

```bash
# for upstream
git clone https://github.com/usenocturne/nocturne-ui.git
# for forks
git clone https://github.com/yourusername/nocturne-ui.git

cd nocturne-ui
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

After setting up your local server, you may follow these steps to see your changes on your Car Thing.

1. You need to use a computer or Raspberry Pi as a host device for your Car Thing.
2. SSH into the Car Thing.
   ```
   ssh root@172.16.42.2
   # The login password is "nocturne".
   ```
3. Remount the rootfs as read/write.
   ```
   mount -o remount,rw /
   ```
4. Edit `/etc/init.d/weston`.
   ```
   vi /etc/init.d/weston
   ```
5. Jump to the end of the `command_args` line by using arrow keys to go over it, and type `$`.
6. Enter insert mode with `i` and replace the URL to point to your local server's IP address.
   ```bash
   --app=http://localhost:3000
   # turns into
   --app=http://your.local.ip.address:port
   ```
7. Remount the rootfs as read-only, sync changes, and restart Weston.
   ```
   mount -o remount,ro /
   sync
   rc-service weston restart
   ```

## Contributing

1. Fork the repository
   - Your changes should be based off the `main` branch.
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Commit your changes: `git commit -m 'chore/feat/fix: add new feature'`
   - Please label your commits with chore, feat, fix, and optionally add a 
4. Push to the branch: `git push origin feature/new-feature`
5. Open a Pull Request

## Donate

Nocturne is a massive endeavor, and the team have spent everyday over the last few months making it a reality out of our passion for creating something that people like you love to use.

All donations are split between the four members of the Nocturne team, and go towards the development of future features. We are so grateful for your support!

[Donation Page](https://usenocturne.com/donate)

## Credits

This software was made possible only through the following individuals and open source programs:

- [Brandon Saldan](https://github.com/brandonsaldan)
- [shadow](https://github.com/68p)
- [Dominic Frye](https://github.com/itsnebulalol)
- [bbaovanc](https://github.com/bbaovanc)

<br>

- [Benjamin McGill](https://www.linkedin.com/in/benjamin-mcgill/), for giving Brandon a Car Thing to develop with
- [bishopdynamics](https://github.com/bishopdynamics), for creating the original [superbird-tool](https://github.com/bishopdynamics/superbird-tool), and [superbird-debian-kiosk](https://github.com/bishopdynamics/superbird-debian-kiosk)
- [Thing Labs's fork of superbird-tool](https://github.com/thinglabsoss/superbird-tool), for their contributions on the original superbird-tool

## Related

- [nocturne-image](https://github.com/usenocturne/nocturne-image) - The Alpine image that runs this web application
- [nocturned](https://github.com/usenocturne/nocturned) - Local API for the Car Thing to handle bluetooth + others

## License

This project is licensed under the **GPL-3.0** license.

We kindly ask that any modifications or distributions made outside of direct forks from this repository include attribution to the original project in the README, as we have worked hard on this. :)

---

> © 2025 Nocturne.

> "Spotify" and "Car Thing" are trademarks of Spotify AB. This software is not affiliated with or endorsed by Spotify AB.

> [usenocturne.com](https://usenocturne.com) &nbsp;&middot;&nbsp;
> GitHub [@usenocturne](https://github.com/usenocturne)
