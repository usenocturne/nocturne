# Nocturne UI Deployment Guide

This is the practical workflow for updating the Nocturne UI on a Spotify Car Thing.

## Your setup

- **Windows PC**: main coding machine, runs the Windows Companion, and can build the React UI with Bun.
- **Mac mini**: deployment bridge to the Car Thing.
- **Car Thing**: runs Nocturne and serves the active UI from:

```text
/opt/nocturne/webapps/ui
```

## The short version

```text
Code changes
   ↓
bun run build
   ↓
packages/ui/dist
   ↓
copy dist to Mac mini if built on Windows
   ↓
tar | ssh to Car Thing
   ↓
restart Chromium
```

You do **not** need to rebuild the full Nocturne firmware for normal UI changes.

---

## 1. Build the UI

The UI source lives in:

```text
packages/ui/
```

The production build is created in:

```text
packages/ui/dist/
```

### Build on Windows

From `my-turne\packages\ui`:

```powershell
bun install
bun run build
```

Then confirm:

```powershell
dir dist
```

You should see:

```text
index.html
assets
```

### Build on the Mac mini

```bash
cd packages/ui
bun install
bun run build
cd ../..
```

If `just` is installed, you can also use:

```bash
just ui-build
```

---

## 2. Configure the Windows Companion connection

Create:

```text
packages/ui/.env.local
```

with:

```env
VITE_WINDOWS_HOST_URL=ws://<WINDOWS_LAN_IP>:8893
VITE_WINDOWS_TOKEN=<SHARED_TOKEN>
```

Use the same token as the Windows Companion.

These values are embedded into the UI when you run:

```bash
bun run build
```

So:

- changing the Windows IP requires another build
- changing the token requires another build
- `.env.local` should not be committed
- `dist/` should not be committed

---

## 3. If you build on Windows, copy `dist` to the Mac mini

Do **not** use GitHub to transport `dist`.

From Windows PowerShell:

```powershell
ssh alex@<MAC_MINI_IP> "rm -rf ~/my-turne/packages/ui/dist"
scp -r ".\packages\ui\dist" alex@<MAC_MINI_IP>:~/my-turne/packages/ui/
```

Adjust the repo path if your Mac clone lives somewhere else.

Afterward, the Mac should have:

```text
~/my-turne/packages/ui/dist/
```

---

## 4. Connect the Car Thing to the Mac mini

For deployment, connect the Car Thing to the Mac mini with a **data-capable USB cable**.

Test the USB development connection:

```bash
ping nocturne.local
```

Then test SSH:

```bash
ssh -tt root@nocturne.local
```

If the terminal looks blank, type:

```bash
hostname
```

and press Enter.

If the Car Thing returns a hostname, SSH is working.

Exit with:

```bash
exit
```

---

## 5. Deploy the UI with `tar | ssh`

From the **repo root on the Mac mini**, run:

```bash
tar -C packages/ui/dist -cf - . | \
ssh root@nocturne.local '
  rm -rf /opt/nocturne/webapps/ui.next &&
  mkdir -p /opt/nocturne/webapps/ui.next &&
  tar -C /opt/nocturne/webapps/ui.next -xf - &&
  rm -rf /opt/nocturne/webapps/ui.previous &&
  mv /opt/nocturne/webapps/ui /opt/nocturne/webapps/ui.previous &&
  mv /opt/nocturne/webapps/ui.next /opt/nocturne/webapps/ui &&
  systemctl restart chromium-kiosk.service
'
```

You can reuse this exact command for future UI deployments.

---

## 6. What `tar | ssh` does

This part:

```bash
tar -C packages/ui/dist -cf - .
```

means:

```text
-C packages/ui/dist   work from inside dist
-c                    create an archive
-f -                  write the archive to stdout
.                     include everything
```

No `.tar` file is created on disk.

The pipe:

```text
|
```

sends that archive stream directly through SSH:

```text
dist files
   ↓
tar stream
   ↓
SSH
   ↓
Car Thing
```

On the Car Thing:

```bash
tar -C /opt/nocturne/webapps/ui.next -xf -
```

extracts the incoming stream into:

```text
/opt/nocturne/webapps/ui.next
```

The currently running UI stays untouched during the upload.

After extraction succeeds:

```text
current ui  → ui.previous
ui.next     → ui
```

Then Chromium restarts and loads the new UI.

Final layout:

```text
/opt/nocturne/webapps/
├── ui/             ← new build
└── ui.previous/    ← previous build
```

---

## 7. Why the repo's `rsync` helper failed

The repo includes:

```bash
./image/scripts/nocturne-push-webapp
```

That helper uses `rsync`.

`rsync` must exist on **both** machines:

```text
Mac mini       Car Thing
rsync ✅        rsync required
```

Your production Car Thing image does **not** include `rsync`.

The repo only installs `rsync` in the **development image**, which is why you saw:

```text
sh: rsync: command not found
```

Your Mac had `rsync`; the Car Thing did not.

### Why `tar | ssh` works

The production image already has:

- SSH
- `tar`

So `tar | ssh` simply sends the complete Vite build each time.

For a small UI bundle, this is completely reasonable.

---

## 8. `rsync` vs `tar | ssh`

### `rsync`

```text
compare both directories
      ↓
send only changed files
```

Advantages:

- efficient for large directories
- transfers only differences
- handles incremental updates well

Disadvantage here:

- requires `rsync` on the Car Thing

### `tar + SSH`

```text
package entire dist
      ↓
send over SSH
      ↓
extract on Car Thing
```

Advantages:

- works on the production Car Thing
- simple
- no extra package needed
- transfers the complete build consistently

Disadvantage:

- sends the entire `dist` directory every time

For the Nocturne UI, that tradeoff is fine.

---

## 9. Verify the deployed UI

Seeing:

```text
index.html
assets/
```

does **not** prove the new build was deployed because every Vite build has those names.

### Quick verification

On the Mac:

```bash
shasum -a 256 packages/ui/dist/index.html
```

On the Car Thing:

```bash
ssh root@nocturne.local \
  'sha256sum /opt/nocturne/webapps/ui/index.html'
```

The hash values should match.

### Full byte-for-byte verification

On the Mac:

```bash
(cd packages/ui/dist && find . -type f -exec shasum -a 256 {} \; | sort) \
  > /tmp/local-ui.sha
```

Then:

```bash
ssh root@nocturne.local \
  'cd /opt/nocturne/webapps/ui && find . -type f -exec sha256sum {} \; | sort' \
  > /tmp/carthing-ui.sha
```

Compare:

```bash
diff -u /tmp/local-ui.sha /tmp/carthing-ui.sha
```

If `diff` prints nothing, the deployed UI matches your local `dist`.

---

## 10. Sprint 2 Windows Companion test

On Windows:

```powershell
$env:NOCTURNE_HOST="<WINDOWS_LAN_IP>"
$env:NOCTURNE_PORT="8893"
$env:NOCTURNE_AUTH_TOKEN="<SHARED_TOKEN>"

cargo run -p nocturne-windows-companion
```

Or use:

```powershell
.\run-windows-companion.local.ps1
```

Check that it is listening:

```powershell
netstat -ano | findstr 8893
```

For the LAN test it should listen on the Windows LAN address, not only:

```text
127.0.0.1
```

---

## 11. Sprint 2 physical acceptance test

After deploying the updated UI:

1. Start the Windows Companion.
2. Confirm the Car Thing has the new UI.
3. Disconnect the USB **data** connection.
4. Keep the Windows PC and Car Thing on the same LAN/Wi-Fi.
5. Confirm the Car Thing connects to the Windows Companion.
6. Stop the Windows Companion with `Ctrl+C`.
7. Confirm the Windows host becomes offline.
8. Confirm normal Nocturne / Spotify continues working.
9. Restart the Windows Companion.
10. Confirm the Car Thing reconnects automatically.
11. Test once with an incorrect token and confirm the connection is safely rejected.

If all of those pass, Sprint 2's physical acceptance criteria are complete.

---

# Everyday workflow

## If coding/building on Windows

### Windows

```powershell
cd packages\ui
bun run build
```

Copy `dist` to the Mac:

```powershell
ssh alex@<MAC_MINI_IP> "rm -rf ~/my-turne/packages/ui/dist"
scp -r ".\dist" alex@<MAC_MINI_IP>:~/my-turne/packages/ui/
```

### Mac mini

```bash
cd ~/my-turne
```

Deploy:

```bash
tar -C packages/ui/dist -cf - . | \
ssh root@nocturne.local '
  rm -rf /opt/nocturne/webapps/ui.next &&
  mkdir -p /opt/nocturne/webapps/ui.next &&
  tar -C /opt/nocturne/webapps/ui.next -xf - &&
  rm -rf /opt/nocturne/webapps/ui.previous &&
  mv /opt/nocturne/webapps/ui /opt/nocturne/webapps/ui.previous &&
  mv /opt/nocturne/webapps/ui.next /opt/nocturne/webapps/ui &&
  systemctl restart chromium-kiosk.service
'
```

That's the normal deployment loop.

---

# Quick reference

## Build

```bash
cd packages/ui
bun run build
cd ../..
```

## Deploy

```bash
tar -C packages/ui/dist -cf - . | \
ssh root@nocturne.local '
  rm -rf /opt/nocturne/webapps/ui.next &&
  mkdir -p /opt/nocturne/webapps/ui.next &&
  tar -C /opt/nocturne/webapps/ui.next -xf - &&
  rm -rf /opt/nocturne/webapps/ui.previous &&
  mv /opt/nocturne/webapps/ui /opt/nocturne/webapps/ui.previous &&
  mv /opt/nocturne/webapps/ui.next /opt/nocturne/webapps/ui &&
  systemctl restart chromium-kiosk.service
'
```

## Verify

```bash
shasum -a 256 packages/ui/dist/index.html
ssh root@nocturne.local \
  'sha256sum /opt/nocturne/webapps/ui/index.html'
```

## Active UI

```text
/opt/nocturne/webapps/ui
```

## Previous UI

```text
/opt/nocturne/webapps/ui.previous
```
