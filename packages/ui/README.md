
<h1 align="center">
  <br>
  <img src="https://raw.githubusercontent.com/usenocturne/nocturne-image/refs/heads/main/pictures/nocturne-logo.png" alt="Nocturne" width="200">
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

4. Set up your Supabase project:
   - Create a new project at [Supabase](https://supabase.com)
   - Create a new table named `spotify_credentials` with the following schema:

```sql
create table spotify_credentials (
  id uuid default uuid_generate_v4() primary key,
  temp_id text not null,
  client_id text not null,
  encrypted_client_secret text not null,
  refresh_token text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  expires_at timestamp with time zone,
  last_used timestamp with time zone,
  first_used_at timestamp with time zone,
  token_refresh_count integer default 0,
  user_agent text,
  session_id TEXT,
  auth_completed BOOLEAN,
  access_token TEXT,
  token_expiry TIMESTAMPTZ
);

-- Add policies for Row Level Security (RLS)
alter table spotify_credentials enable row level security;

-- Cleanup expired records
create policy "Cleanup expired records"
on spotify_credentials for all
using (expires_at < current_timestamp or refresh_token = current_setting('app.current_refresh_token'::text, true));

-- Cleanup unused temp IDs
create policy "cleanup_unused_temp_ids"
on spotify_credentials for all
using (created_at < current_timestamp - interval '1 hour' and refresh_token is null);

-- Enforce expiration
create policy "Enforce expiration"
on spotify_credentials for all
using (expires_at is null or expires_at > current_timestamp);

-- Update restrictions
create policy "Restricted updates"
on spotify_credentials for update
using (temp_id is not null)
with check (
  client_id = (select client_id from spotify_credentials where id = id)
  and encrypted_client_secret = (select encrypted_client_secret from spotify_credentials where id = id)
  and temp_id = (select temp_id from spotify_credentials where id = id)
  and created_at = (select created_at from spotify_credentials where id = id)
);

-- Insert validation
create policy "Validated inserts"
on spotify_credentials for insert
with check (
  temp_id is not null 
  and client_id is not null 
  and encrypted_client_secret is not null 
  and length(temp_id) >= 7 
  and created_at <= current_timestamp 
  and (expires_at is null or expires_at > current_timestamp)
  and not exists (
    select 1 from spotify_credentials sc 
    where sc.temp_id = spotify_credentials.temp_id
  )
);
```

5. Generate encryption keys:
```bash
# Generate 32-byte key for AES-256
openssl rand -hex 32

# Generate 16-byte IV
openssl rand -hex 16
```

6. Update your `.env.local` with the required values:
```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key

# Spotify
NEXT_PUBLIC_SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
NEXT_PUBLIC_REDIRECT_URI=https://your.local.ip.address:port

# Encryption (from step 5)
ENCRYPTION_KEY=your_32_byte_hex_key
ENCRYPTION_IV=your_16_byte_hex_key
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
const { createServer } = require('https');
const { parse } = require('url');
const next = require('next');
const fs = require('fs');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const httpsOptions = {
  key: fs.readFileSync('./cert.key'),
  cert: fs.readFileSync('./cert.crt')
};

app.prepare().then(() => {
  createServer(httpsOptions, (req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  }).listen(3000, (err) => {
    if (err) throw err;
    console.log('> Ready on https://localhost:3000');
    console.log('> Also available on https://your.local.ip.address:3000');
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

## Cloudflare Deployment Setup

1. Install Wrangler CLI:
```bash
npm install -g wrangler
```

2. Login to Cloudflare:
```bash
wrangler login
```

3. Create a KV namespace for encryption keys:
```bash
cd workers/key-rotation
npx wrangler kv:namespace create ENCRYPTION_KEYS
```

4. Update the KV namespace ID in your root `wrangler.toml`:
```toml
name = "nocturne"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = ".vercel/output/static"

kv_namespaces = [
  { binding = "ENCRYPTION_KEYS", id = "your_namespace_id_here" }
]

[vars]
NEXT_PUBLIC_REDIRECT_URI = "your_production_url"
NEXT_PUBLIC_SUPABASE_URL = "your_supabase_url"
NEXT_PUBLIC_SPOTIFY_CLIENT_ID = "your_client_id"
```

5. Set up environment secrets:
```bash
# For the main app
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put SPOTIFY_CLIENT_SECRET
npx wrangler secret put ENCRYPTION_KEY
npx wrangler secret put ENCRYPTION_IV

# For the key rotation worker
cd workers/key-rotation
npx wrangler secret put ENCRYPTION_KEY
npx wrangler secret put ENCRYPTION_IV
```

6. Deploy the key rotation worker:
```bash
cd workers/key-rotation
npx wrangler deploy
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

## Key Rotation

The project includes automatic key rotation for encrypted credentials. The rotation worker runs every 7 days and:
- Generates new encryption keys
- Re-encrypts existing credentials
- Maintains backups during rotation
- Handles failures gracefully

The rotation schedule can be modified in `workers/key-rotation/wrangler.toml`.

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

