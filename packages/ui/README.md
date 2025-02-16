<h1 align="center">
  <br>
  <img src="https://usenocturne.com/images/logo.png" alt="Nocturne" width="200">
  <br>
  nocturne
  <br>
</h1>

<h4 align="center">A web application for <a href="https://github.com/usenocturne/nocturne-image" target="_blank">nocturne-image</a> and the <a href="https://carthing.spotify.com/" target="_blank">Spotify Car Thing</a>.</h4>

<p align="center">
  <a href="#how-to-use">How To Use</a> •
  <a href="#spotify-developer-setup">Spotify Developer Setup</a> •
  <a href="#local-development-setup">Local Development Setup</a> •
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

### Custom Credentials

1. First, follow the steps in <a href="#spotify-developer-setup">Spotify Developer Setup</a>.
2. Follow the steps for your operating system in <a href="https://github.com/usenocturne/nocturne-image?tab=readme-ov-file#how-to-use">the image's repo</a>.
3. Once running on your Car Thing, press "Login with Phone" and scan the QR Code.
4. Enter your Spotify Client ID and Client Secret on your phone. Your credentials will be encrypted and stored securely.
5. Authorize with Spotify and start using Nocturne!

### Default Credentials (Beta)

**It is not recommended to use default credentials at this point in time. Unless you know what you're doing, please use custom credentials**

1. First, follow the steps in <a href="#spotify-developer-setup">Spotify Developer Setup</a>
2. Follow the steps for your operating system in <a href="https://github.com/usenocturne/nocturne-image?tab=readme-ov-file#how-to-use">the image's repo</a>.
3. Once running on your Car Thing, hold the back button (under the knob) until the "Use Default Credentials (Beta)" button appears
4. Press the "Use Default Credentials (Beta)" button
5. Authorize with Spotify and start using Nocturne!

### Button Mapping and Button Usage

- Hold one of the top hardware preset buttons while on a playlist page to map it to the button
- Press the mapped buttons to quickly play playlists
- Hold the right-most top hardware button to access settings
- Triple-press the right-most top hardware button to access brightness control
- Press the hardware button underneath of the knob to go back in the application

## Spotify Developer Setup

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)

2. Log in with your Spotify account (create one if needed)

3. Click "Create App"

   - App name: Choose a name (e.g., "Nocturne")
   - App description: Brief description of your app
   - Redirect URI: Add `https://nocturne.brandons.place` for non-development usage, or `https://your.local.ip.address:port` for development usage
   - Select "Web API" and "Web Playback SDK" as the API's you will be using

4. After creating the app, you'll see your:
   - Client ID (shown on the dashboard)
   - Client Secret (click "Show Client Secret")

## Local Development Server

First, set up the configuration and database:

1. Clone the repository:

```bash
git clone https://github.com/yourusername/nocturne-ui.git
cd nocturne
```

2. Install dependencies:

```bash
npm install
# or
yarn install
# or
bun install
```

3. Copy the environment example file:

```bash
cp .env.example .env.local
```

4. Update your `.env.local` with the required values:

```env
# Spotify
NEXT_PUBLIC_SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
NEXT_PUBLIC_REDIRECT_URI=your_redirect_uri

# Development Environment
NODE_ENV=development

# API Variables
NEXT_PUBLIC_API_BASE_URL=your_api_url
```

Now, it's time to:

### Run the local dev server

Nocturne requires HTTPS to make API requests, so you need to set up HTTPS on the local server. This makes two different ways to run the dev server:

#### Method #1: Using [Caddy][caddy-download]

[caddy-download]: https://caddyserver.com

This will use Caddy as a reverse proxy in front of Next.js's dev server.

On the last step where you start the development server, use `npx next dev` and then in another tab/
window, `caddy run` to start. It will run on https://localhost:3443.

1. Install Caddy: this can be done with your OS package manager, or by downloading the executable from https://caddyserver.com/download.

2. Start the Next.js dev server:

```bash
npx next dev
```

3. In a different tab/window, start Caddy. This will run at https://localhost:3443.

```bash
caddy run
```

This may prompt you for a `sudo` password to install Caddy's certificate on your system, to make it automatically trusted.

#### Method #2: Using `mkcert` and JS webserver

First, install `mkcert`.

```bash
# macOS
brew install mkcert

# Windows (using chocolatey)
choco install mkcert

# Linux
apt install mkcert
```

Trust the mkcert CA system-wide.

```bash
mkcert -install
```

Generate a certificate for localhost (and local IP addresses).

```bash
mkcert localhost 127.0.0.1 ::1 your.local.ip.address
```

Copy the certificate to the current dir.

```bash
# Rename the generated certificates
mv localhost+3.pem cert.crt
mv localhost+3-key.pem cert.key

# Copy CA certificates (locations vary by OS)
# macOS
cp "$(mkcert -CAROOT)/rootCA.pem" ca.crt
cp "$(mkcert -CAROOT)/rootCA-key.pem" ca.key

# Windows
copy "%LOCALAPPDATA%\mkcert\rootCA.pem" ca.crt
copy "%LOCALAPPDATA%\mkcert\rootCA-key.pem" ca.key

# Linux
cp "$(mkcert -CAROOT)/rootCA.pem" ca.crt
cp "$(mkcert -CAROOT)/rootCA-key.pem" ca.key
```

Create custom server file at `./server.js`:

```js
const { createServer } = require("https");
const { parse } = require("url");
const next = require("next");
const fs = require("fs");

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

const httpsOptions = {
  key: fs.readFileSync("./cert.key"),
  cert: fs.readFileSync("./cert.crt"),
};

app.prepare().then(() => {
  createServer(httpsOptions, (req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  }).listen(3000, (err) => {
    if (err) throw err;
    console.log("> Ready on https://localhost:3000");
    console.log("> Also available on https://your.local.ip.address:3000");
  });
});
```

Run the server:

```bash
npm run dev
# or
yarn dev
# or
bun dev
```

## Displaying your local environment on the Car Thing
After setting up your local server, you may follow these steps to see your changes on your car thing.
1. *If you're using ***Method #2*** for your local server, you can skip this step.*  
  Edit your `Caddyfile` to include your local server's IP address:
    ```Caddyfile
    https://localhost:3443 {
      reverse_proxy localhost:3000
    }

    https://your.local.ip.address:3443 {
      reverse_proxy localhost:3000
    }
    ```
2. SSH into your Raspberry pi.
   ```
   ssh pi@raspberrypi.local
   ```
3. SSH into the Car Thing.
   ```
   ssh superbird@192.168.7.2
   # The login password is "superbird".
   ```
4. Edit `/scripts/chromium_settings.sh`.
   ```
   nano /scripts/chromium_settings.sh
   ```
5. Replace the URL to point to your local server's IP address.
- If you're using **Method #1**, replace `port` with `3443`.
- If you're using **Method #2**, replace `port` with `3000`.
   ```bash
   # settings for /scripts/start_chromium.sh

   # URL="https://nocturne.brandons.place/"
   URL="https://your.local.ip.address:port/"
   ```
6. Reboot your Car Thing to apply your changes.
   ```
   sudo reboot
   ```

## Contributing

1. Fork the repository
   - Your changes should be based off the `main` branch.
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Commit your changes: `git commit -m 'Add new feature'`
4. Push to the branch: `git push origin feature/new-feature`
5. Open a Pull Request

## Security

- Client secrets are encrypted using AES-256-CBC
- Keys are automatically rotated every 7 days
- Credentials are stored with expiration dates
- Unused credentials are automatically cleaned up
- All sensitive operations happen server-side

## Donate

Nocturne is a massive endeavor, and the team have spent everyday over the last few months making it a reality out of our passion for creating something that people like you love to use.

All donations are split between the four members of the Nocturne team, and go towards the development of future features. We are so grateful for your support!

## Credits

This software was made possible only through the following individuals and open source programs:

- [Benjamin McGill](https://www.linkedin.com/in/benjamin-mcgill/), for giving me a Car Thing to develop with
- [shadow](https://github.com/68p), for OS development, testing, troubleshooting, and crazy good repo maintainence
- [Dominic Frye](https://x.com/itsnebulalol), for OS development, debugging, testing, and marketing
- [bbaovanc](https://x.com/bbaovanc), for OS development, debugging, and testing
- [bishopdynamics](https://github.com/bishopdynamics), for creating the original [superbird-tool](https://github.com/bishopdynamics/superbird-tool), and [superbird-debian-kiosk](https://github.com/bishopdynamics/superbird-debian-kiosk)
- [Car Thing Hax Community's fork of superbird-tool](https://github.com/Car-Thing-Hax-Community/superbird-tool), for their contributions on the original superbird-tool

## Related

[nocturne-image](https://github.com/usenocturne/nocturne-image) - The Debian image that runs this web application

## License

This project is licensed under the **GPL-3.0** license.

We kindly ask that any modifications or distributions made outside of direct forks from this repository include attribution to the original project in the README, as we have worked hard on this. :)

---

> [brandons.place](https://brandons.place/) &nbsp;&middot;&nbsp;
> GitHub [@brandonsaldan](https://github.com/brandonsaldan) &nbsp;&middot;&nbsp;
> Twitter [@brandonsaldan](https://twitter.com/brandonsaldan)
