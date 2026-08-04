# NOCTURNE-UI — CAR THING WEB FRONTEND

**Generated:** 2026-05-05
**Commit:** 643cfe2
**Branch:** main
**Related repos** (separate sibling checkouts, NOT subdirs of this one): `nocturned` (the daemon this UI talks to over WS :5000), `nocturne-image` (Buildroot firmware that bakes this UI's `dist/` into the kiosk).

## OVERVIEW

Vite + React 19 SPA served by Chromium kiosk on the Spotify Car Thing (800×480, rotary dial + touch + hardware preset buttons). Talks to the `nocturned` daemon over WebSocket on port 5000 (same origin). No Spotify Web API calls from the browser — everything is proxied via the daemon.

## STACK

- **Vite 6** + `@vitejs/plugin-react-swc` (SWC, not Babel)
- React 19.2 + react-router-dom 7 + MobX 6 (mockingbird only)
- Tailwind CSS 3 + SCSS modules (mockingbird only) + `@headlessui/react`
- TypeScript (`.ts` / `.tsx`)
- `bun` as package manager (`bun.lockb`, NOT `package-lock.json`)

## STRUCTURE

```
nocturne-ui/
├── index.html            # Single root div, loads src/main.tsx
├── vite.config.js        # Minimal Vite config — just the React SWC plugin
├── postcss.config.js     # Tailwind + autoprefixer
├── tailwind.config.js    # 12-language font-family stack (Inter + Noto variants), resolved from system-installed fonts
├── eslint.config.js      # Flat config, JS only, no TS
├── .prettierrc           # EMPTY file — defaults only
└── src/
    ├── main.tsx          # Entry: ReactDOM.createRoot(...).render(<App />)
    ├── App.tsx           # God component: auth flow, routing, providers
    ├── index.css         # Tailwind directives + global styles + `:root` block defining `--font-*` CSS vars (resolve to system-installed font families)
    ├── pages/Home.jsx    # Sidebar-driven home (+ sections under pages/home/)
    ├── components/       # UI components — see src/components/AGENTS.md
    ├── hooks/            # 18 hooks, ~10K lines, singleton state — see src/hooks/AGENTS.md
    ├── mockingbird/      # Alt UI (stock Spotify skin) — see src/mockingbird/AGENTS.md
    ├── contexts/         # SettingsContext, OTAContext, NotificationContext, VoiceContext
    └── utils/            # colorExtractor (album art → gradient), helpers
```

## APP FLOW

```
main.jsx
 └─ <App />
     └─ SettingsProvider → OTAProvider → NotificationProvider → VoiceProvider → DeviceSwitcherContext
         └─ <Router>  (BrowserRouter, see "Routing" below)
             └─ <UIShell isMockingbird={settings.mockingbirdUiEnabled}>
                 ├─ mockingbird true  → React.lazy(MockingbirdShell)     (mockingbird/)
                 └─ mockingbird false → {content}  (switch on activeSection/viewingContent):
                     ├─ "nowPlaying"     → NowPlaying
                     ├─ "lock"           → LockView
                     ├─ viewingContent   → ContentView (album/playlist/artist/show)
                     ├─ auth/network/... → AuthScreen / NetworkScreen / SplashScreen / Tutorial
             └─ default          → Home (sections: recents, library, artists, radio, podcasts)
```

Overlays render outside the switch: `PairingScreen`/`MockingbirdPairingOverlay`, `NetworkBanner`, `DeviceSwitcherModal`, `ButtonMappingOverlay`, `PowerMenuOverlay`, `VoiceOverlay`, `NotificationsContainer`.

The splash, provider state, notification bridge, Recents, and shared shell stay in the entry bundle. Tutorial, content, Now Playing, Settings, inactive Home sections, and normally closed overlays use `React.lazy` with local Suspense boundaries. Event state remains eager, and overlays with exit animations stay mounted after their first use.

`IncomingCallOverlay` is the highest interactive UI layer. It renders above voice and notifications, but below the display sleep blackout. A native phone incoming call wakes the display, suppresses voice, pauses idle locking, and closes power and device switcher overlays.

## ROUTING

**`BrowserRouter` is wrapped but no `<Route>` is declared anywhere.** It exists solely so descendants can call `useNavigate()`/`useNavigate` hooks from `react-router-dom`. Screen selection is an internal state machine driven by `App.jsx` props (`activeSection`, `viewingContent`, screen-visibility booleans) — don't add `<Route path=...>` expecting it to do anything.

## WHERE TO LOOK

| Task                                  | Location                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mount order / provider stack          | `src/App.tsx` bottom (last 100 lines)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Which screen renders when             | `src/App.tsx` content switch + `mockingbirdSystemScreen`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Add/modify a daemon command           | `src/hooks/useNocturned.ts` → `sendNocturneWsRequest()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Add/modify a Spotify command          | `src/hooks/useSpotifyWebSocket.ts` → `sendSpotifyCommand()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Add a user setting                    | `src/contexts/SettingsContext.tsx` (localStorage-backed defaults table)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Bluetooth pairing window              | The first-run `AuthScreen` owns `bluetooth.discoverable` while no known phone or `app.ready` session exists, so the app can discover an unconfigured Car Thing directly from the QR screen. After initial setup, `BluetoothDevices.tsx` owns the window only while its explicit device list is open. A shared lease coordinator in `useNocturned.ts` serializes overlapping UI owners and restores the requested state after a WebSocket reconnect. A PIN overlay must not unmount the active owner during AccessorySetupKit's LE-to-classic bridge.                                                                                                          |
| Add a font                            | Install the font on the kiosk Linux system through the Yocto `nocturne-fonts` recipe and on the dev machine; reference its family in `tailwind.config.js` + `src/index.css` `:root`. The app does not load any `@font-face` itself.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Toggle stock Spotify skin             | `mockingbirdUiEnabled` setting (gated in `UIShell.tsx`). Switching from Nocturne to Mockingbird is reactive and must preserve the parent Spotify state; do not reload the page, because a cold boot blocks Mockingbird behind the expanded library fetch.                                                                                                                                                                                                                                                                                                                                                                                                     |
| Hardware-button preset long-press map | `src/hooks/useButtonMapping.tsx` + `App.tsx:useGlobalButtonMapping`; storage is device-scoped through `src/utils/presetStorage.ts` using `lastConnectedBluetoothDevice`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| OTA update UX                         | `src/contexts/OTAContext.tsx` + `src/components/settings/SoftwareUpdate`: progress events may include `asset`, `transferredBytes`, and `totalBytes` during full-image zchunk delta transfers, which the settings screen uses to distinguish boot and system image transfer states.                                                                                                                                                                                                                                                                                                                                                                            |
| Phone and system notifications        | `src/components/common/notifications/NotificationBridge.tsx` presents companion and ANCS events plus validated OTA availability. Mirrored phone alerts require the saved preference, a direct phone, and strict Nocturne+ access; they are bounded and auto-dismiss. System OTA notices ignore the phone toggle, deduplicate each release, and remain until dismissed or superseded.                                                                                                                                                                                                                                                                          |
| Native phone calls                    | `src/hooks/usePhoneCalls.ts` consumes complete `phone.call.started`, `phone.call.updated`, and `phone.call.ended` snapshots, replays state with `phone.calls.get` after Android or iOS `app.ready` establishes a usable route, and sends targeted accept or decline actions. App owns this state once and selects the Nocturne overlay at `src/components/common/overlays/call/IncomingCallOverlay.tsx` or the Mockingbird overlay exposed through `src/mockingbird/UIShell.tsx`. Effective presentation requires the saved `nativePhoneCallsEnabled` preference, a direct phone connection, and strict Nocturne+ access without stopping lifecycle tracking. |
| Icon library                          | `src/components/common/icons/index.tsx` barrel exports the shared UI icons. `NotificationAppIcons.tsx` maps known iOS bundle IDs and Android package names to locally bundled artwork used by mirrored notification banners.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Voice assistant overlay               | `src/components/common/overlays/voice/` + `src/contexts/VoiceContext.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Voice Cancel Contract

Both UI skins must send `audio.record.stop` and `voice.cancel` when dismissing an active voice session. `audio.record.stop` halts daemon capture; `voice.cancel` is forwarded to the phone app so transcription, AI, TTS, and audio ducking are reset even if recording already ended by silence.

The microphone fails closed for connector platforms. Both `web` and `macos` `app.ready` sessions keep wake-word controls disabled unless a future attested macOS connector advertises an explicit voice capability. Do not infer macOS voice support from the platform name alone.

### Display Sleep Contract

The rightmost top button opens the lock screen; it must not immediately turn off the backlight. The General setting `idleLockEnabled` auto-locks after 5 minutes of inactivity. The separate `idleDisplaySleepEnabled` setting turns the backlight off after 20 minutes of inactivity while playback is not actively playing by sending `device.display.sleep` on the existing `nocturned` WebSocket, and wakes with `device.display.wake` on the first wake input, player event, or processed `player.state` response with `is_playing: true`. The daemon owns transient backlight restore, including auto-brightness restart. Do not implement sleep by calling `device.brightness.set`; it persists manual brightness and can leave the device saved at the dimmest value.

The power menu's manual brightness slider must never reach physical backlight value `0`, because releasing it there leaves the screen off with no UI path to recover. Keep its minimum at `8`; physical value `0` is reserved for transient `device.display.sleep`.

### Phone Volume Sync Contract

The `phone.volume.update` event is phone system-volume sync from the phone app. It may arrive at startup, route changes, polling intervals, or from user volume-button holds that move quickly across the range. The main and Mockingbird volume overlays update immediately from phone volume messages after the hidden startup baseline, including large jumps. Car Thing knob volume for phone media must wait for the reported phone volume instead of showing directional placeholder arrows.

### Spotify-Sourced Phone Media While Skipped

`media.nowPlaying.update` events with `PlaybackAppName: "Spotify"` normally park on a pending placeholder (`useSpotifyPlayerState.ts`) and wait for real Spotify Connect data. When Spotify auth is skipped (`getSpotifySkippedState()`), that data can never arrive, so the same events must fall through to the regular other-media path (`is_phone_media: true`, OtherMedia NPV) instead. Companions (phone apps and the macOS connector) keep sending `PlaybackAppName: "Spotify"` unchanged — the routing decision is the UI's, based on its own auth state.

While Spotify IS linked, Spotify data outranks Spotify-named media events: for the same track they may only fast-path `is_playing`/progress, never item metadata — `MediaItemArtist` is a first-artist-only string (from MediaRemote / phone media sessions) and writing it over a real item clobbers the full artist list until the next dealer event. Metadata from a media event is applied only as a transitional hint on an actual track change, and even then only when the dealer has been quiet for 8s (`DEALER_FRESH_THRESHOLD_MS`).

Artwork events may include the same optional `media_generation` as their metadata update. Both UI skins accept artwork only when both events carry the same generation or both omit it. This preserves legacy and native iAP2 media while rejecting stale mixed pairs. Keep pushed artwork available for pending Spotify fallbacks and non-Spotify media, but never attach it to a canonical Spotify item or inject it into canonical Spotify image URLs. When correlated metadata names a genuinely different Spotify track, its pushed artwork may immediately promote the pending placeholder; canonical Dealer state replaces that transition normally. Otherwise a fast media update followed by artwork can permanently give the previous album the next track's cover in either UI skin.

An inactive named phone-media event from another app must not displace canonical Spotify while Spotify is actively playing. Android can retain stopped or paused media sessions long after their app was last used. Accept a foreign app immediately when its phone session is playing or loading, and continue accepting pause/stop once phone media already owns the UI, but treat a dormant foreign session as stale while active canonical Spotify owns playback.

Spotify authentication status can arrive before the companion's `app.ready` event during a cold AccessorySetupKit launch. The first `spotify.player.state` response may be empty while the companion finishes startup. Keep the bounded post-ready retry in `useSpotifyPlayerState.ts`, and do not treat an empty warmup response as authoritative because it can erase native phone metadata. The retry is keyed to the monotonic `app.ready` generation because BlueZ's generic Bluetooth `connected` flag can remain false for a healthy iAP2 session.

Library startup follows the same readiness boundary. `useSpotifyData.ts` must not issue profile, recents, playlist, artist, liked-song, radio, or show requests until the current companion has emitted `app.ready`. A generic Bluetooth connection and an early Spotify auth event are not sufficient. Each initial load is keyed to the monotonic `app.ready` generation, uses the profile response as its warmup probe, and completes only after the required collection batch succeeds. Radio can degrade to its two offline mixes. Mockingbird consumes this parent-owned data instead of issuing a second startup batch.

## CONVENTIONS

- **Formatter = Prettier defaults.** `.prettierrc` is intentionally empty. Run `bun run lint` (writes) or `bun run lint-check` (verifies). No ESLint fix step in package scripts.
- **Module-level singleton hooks:** `useNocturned`, `useSpotifyData`, `useSpotifyPlayerState`, `useSpotifyWebSocket` hold state in module scope with pub/sub. Do not "lift" into Context. See `src/hooks/AGENTS.md`.
- **Preset persistence is per paired phone:** main UI preset button mappings are stored under `nocturne_presets:<bluetooth-address>` and Mockingbird preset slots under `mockingbird_presets:<bluetooth-address>` via `src/utils/presetStorage.ts`. Do not read or write legacy global keys (`button1Id`, global `nocturne_presets`) except through that migration helper.
- **All remote I/O via the daemon:** never `fetch('api.spotify.com/...')`. Calls go through `sendSpotifyCommand` → daemon → iAP2 → iPhone.
- **Protocol-v2 OTA targets are pinned:** `OTAContext` reports companion check failures as errors, and both manual and automatic installs send the channel, version, and kind from the preceding check. Install requests remain pending only until a matching `ota.begin`, terminal event, route generation change, or bounded timeout. Never silently install a release that changed between check and install.
- **OTA version lanes stay distinct:** `useNocturneInfo` retains the effective legacy version plus the rootfs image and bandaid versions from `device.version`. Every check and install sends all available lanes. Persisted image progress reconciles against the image lane; daemon, builtin webapp, and bandaid progress reconcile against the bandaid lane.
- **Automatic update policy is authoritative:** startup, reconnect, retry, and periodic discovery run regardless of the Automatic Updates setting, but automatic discovery waits for the kiosk-lifetime initial library load signal. Spotify-skipped sessions satisfy that signal immediately. Manual checks bypass it. Once `OTAContext` discovers an installable update, it requests installation whenever Automatic Updates is enabled, including when the user enables the setting after the check completed. When disabled, discovery stops at the manual `Download & Install` action and `NotificationBridge` presents one deduplicated system notice for the release.
- **OTA startup follows initial data:** automatic checks start after the initial library load, daemon socket, `app.ready`, and installed device version are ready. The initial data signal is one-time for the kiosk process and is not reset for later companion generations. Keep manual checks available while it is pending.
- **OTA activation matches the payload:** `daemon` and combined `bandaid` completion restart `nocturned` through a delayed transient systemd unit after `ota.complete`; `daemon`, `builtinWebapp`, and `bandaid` therefore need only a kiosk reload. Full `image` updates stage the inactive slot and wait at completion until the user selects Restart.
- **Persisted OTA progress is presentation state:** restored active progress waits briefly for a live daemon event, never starts a duplicate discovery while unresolved, and fails visibly when it cannot be reconciled. Restored active or completed image progress is cleared only when the explicit installed image version already matches the target, because the user-requested restart has happened. Never replace that state with another restart prompt. Component completion remains visible until its explicit reload action. The daemon does not replay OTA terminal events to a newly mounted kiosk WebSocket.
- **Pairing is user initiated:** The first-run QR screen is an active pairing surface until a known phone or `app.ready` session exists. After setup, `BluetoothDevices` opens the daemon pairing window only while the user is in an explicit device list, and Mockingbird uses the equivalent Add Phone modal. Generic connection loss and an empty device list must not open pairing by themselves.
- **Pairing preserves its owner:** A Bluetooth PIN request is a visual overlay, not a replacement system screen. Keep the disconnected `NetworkScreen` and its mounted `BluetoothDevices` subtree alive behind the PIN until an iAP2 `bluetooth.connection` event changes connection state. Canonical `bluetooth.pairing` `event: "paired"`, legacy `type: "pairing_succeeded"`, and agent cancellation clear only the PIN state. Generic BlueZ `bluetooth.device` connectivity is not iAP2 readiness.
- **Cold-start reconnect presentation:** Keep Now Playing mounted while the reconnect singleton has a pending initial attempt, active request, settle window, or scheduled retry. Show Phone Disconnected when no reconnect target exists, the platform requires explicit phone-side connection, or the retry cycle explicitly exhausts. Generic BlueZ connectivity is not app-session readiness.
- **Device info casing:** `device.info` arrives with canonical snake_case metadata fields. Pass responses through `normalizeDeviceInfoResponse` before UI code reads camelCase properties such as `serialNumber`.
- **Image loading:** remote artwork goes through `SpotifyImage` / `useImageLoader`. Direct `<img src=spotify-cdn>` URLs bypass the daemon image proxy and flash on bad networks. The local notification app artwork rendered by `NotificationBanner` is the only direct `<img>` exception.
- **Notification app icons:** resolve ANCS bundle identifiers and Android package names only through `NotificationAppIcons.tsx`. Keep the artwork local and offline, use platform-specific artwork when Apple and Android apps differ, and preserve `SmartphoneIcon` as the fallback for unknown or variant identifiers. Refresh the checked-in App Store JPEG and Google Play PNG assets with `bun run icons:update`.
- **Global cross-UI handles:** `window.carThingRootStore` (mockingbird's MobX root), `window.testShelf`, etc. set by mockingbird for debugging and used sparingly by `App.jsx` for cross-UI toggles. Not a general-purpose globals pattern.
- **Native phone presentation settings:** `SettingsContext` owns `nativePhoneCallsEnabled` and `nativeNotificationsEnabled`. Effective presentation requires `entitlementsVerified === true`, then either `isAdmin === true` or `subscribed === true` with normalized status `active`, `past_due`, or `trialing`. Missing verification, unknown status, pre-auth compatibility access, and lifetime-only access fail closed. Only known `ios` and `android` app platforms count as direct phone sessions. Unknown, Pi connector, and macOS connector sessions stay locked. Locking changes only effective presentation, never the saved preference.
- **Headless UI:** modals/switches use `@headlessui/react` — do not roll your own focus traps.
- **Tailwind font stack:** `className="nocturne-font-stack"` or Tailwind `font-sans` — falls through 12 language variants via CSS vars defined in `src/index.css`'s `:root` block. Those vars resolve to **system-installed** font families (no `@font-face` loading from `public/fonts/`). Don't inline `font-family`.
- **SCSS is mockingbird-only.** Main Nocturne UI uses Tailwind classes; never `import styles from './Foo.module.scss'` outside `src/mockingbird/`.
- **Voice overlay state lives in `src/contexts/VoiceContext.tsx`** (React Context + reducer, same pattern as SettingsContext/OTAContext/NotificationContext).

## ANTI-PATTERNS (THIS PROJECT)

- **Don't add `<Route>` declarations** — the Router is a shell for `useNavigate` only (see ROUTING above). App routing is a state machine in `App.jsx`.
- **Target is the kiosk's latest Chrome.** Modern JS/CSS is fine — no legacy plugin, no polyfills, no inset shorthand fix. Don't reintroduce Chrome 69 workarounds (manual `globalThis`/`Promise.allSettled`/`crypto.randomUUID` fallbacks, `top/right/bottom/left` instead of `inset:`, `@vitejs/plugin-legacy`).
- **Don't import mockingbird code from main Nocturne UI** (except `UIShell.jsx` and the already-lazy `BTPairing` overlay in `App.jsx`). The skin is isolated and uses MobX — importing leaks into the Nocturne bundle.
- **Don't call Spotify Web API directly.** All Spotify data flows through `useSpotifyData`/`useSpotifyWebSocket` → daemon WebSocket. OAuth is handled daemon-side.
- **Don't add a TypeScript file** without team discussion. The project is all-JS by design; `@types/react*` is pinned only for editor hints.
- **Don't add a new state store** when a hook with module-level state will do. Context is used sparingly — for settings, notifications, OTA, and the voice-assistant overlay (`VoiceContext`). Do not add a new Context for a hook with module-level state; see the 4 singleton hooks in `src/hooks/`.
- **`src/components/voice/icons/` remains an empty legacy placeholder.** New main-UI voice UI lives in `src/components/common/overlays/voice/` (aligning with the overlays convention). Mockingbird still owns its own voice UI at `src/mockingbird/ui/components/Listening/` — the two are independent.

## COMMANDS

```bash
bun install           # Install deps (uses bun.lockb)
bun dev               # Vite dev server
bun run build         # Production build → dist/
bun run icons:update  # Refresh checked-in artwork from the App Store and Google Play catalogs
bun run typecheck     # Strict-check shared UI contract declarations (see note below)
bun run preview       # Serve the built bundle
bun run lint          # Prettier --write
bun run lint-check    # Prettier --check (CI)
```

**Deploy to Car Thing:** run `just ui-build` from the repository root, then `just -f image/Justfile push-webapp ../packages/ui/dist ui`. Restart the live kiosk with `ssh root@nocturne.local 'systemctl restart chromium-kiosk.service'` when an immediate reload is needed.

## NOTES

- **Automated tests are intentionally narrow.** `bun test` covers pure state-boundary regressions. Rendering and hardware integration still require manual QA.
- **Typecheck scope is limited.** `bun run typecheck` strictly checks `src/vite-env.d.ts` and `src/types.ts`. Extending it to all of `src/` currently exposes a large legacy typing backlog, so production source coverage still relies on the Vite build until that migration is completed without suppressions or weaker compiler settings.
- **Font binaries do not ship in the UI bundle.** The Yocto `nocturne-fonts` package installs them system-wide, and Chromium resolves Inter, Noto, and `Circular Sp UI v3 T` through fontconfig. Mockingbird's non-Latin Circular files rely on the image's scan-time family mapping, so validate font changes against the image package rather than only the Vite bundle.
- **`@tailwindcss/postcss` v4 is a devDep but the runtime is Tailwind 3.** The v4 package is vestigial/unused — don't migrate to v4 without a coordinated plan (mockingbird SCSS modules + Headless UI will need adjustments).
- **`react-transition-group@4.4.5` is pinned** for React 19 compat via `mockingbird/ui/components/CSSTransitionCompat.jsx`. Don't upgrade.
- **Build targets modern Chrome.** Vite defaults apply — no `@vitejs/plugin-legacy`, no dev-time esbuild downgrade, no manual polyfills. PostCSS is just Tailwind + autoprefixer.
