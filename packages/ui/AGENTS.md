# NOCTURNE-UI — CAR THING WEB FRONTEND

**Generated:** 2026-05-05
**Commit:** 643cfe2
**Branch:** main
**Related repos** (separate sibling checkouts, NOT subdirs of this one): `nocturned` (the daemon this UI talks to over WS :5000), `nocturne-image` (Buildroot firmware that bakes this UI's `dist/` into the kiosk).

## OVERVIEW

Vite + React 19 SPA served by Chromium kiosk on the Spotify Car Thing (800×480, rotary dial + touch + hardware preset buttons). Talks to the `nocturned` daemon over WebSocket on port 5000 (same origin). No Spotify Web API calls from the browser — everything is proxied via the daemon.

## STACK

- **Vite 6** + `@vitejs/plugin-react-swc` (SWC, not Babel)
- **`@vitejs/plugin-legacy`** — builds for Chrome 69 target (Car Thing Chromium is old)
- React 19.2 + react-router-dom 7 + MobX 6 (mockingbird only)
- Tailwind CSS 3 + SCSS modules (mockingbird only) + `@headlessui/react`
- `bun` as package manager (`bun.lockb`, NOT `package-lock.json`)

## STRUCTURE

```
nocturne-ui/
├── index.html            # Single root div, loads src/main.jsx
├── vite.config.js        # Legacy plugin + dev-mode chrome69 transform shim
├── postcss.config.js     # Custom postcss-inset-fix plugin (chrome69 lacks `inset`)
├── tailwind.config.js    # 12-language font-family stack (Inter + Noto variants)
├── eslint.config.js      # Flat config, JS only, no TS
├── .prettierrc           # EMPTY file — defaults only
├── public/fonts/         # 18 woff2 files (Inter + Noto scripts), served statically
└── src/
    ├── main.jsx          # 6-line entry: ReactDOM.createRoot(...).render(<App />)
    ├── App.jsx           # 1420-line God component: auth flow, routing, providers
    ├── index.css         # Tailwind directives + global styles
    ├── pages/Home.jsx    # Sidebar-driven home (+ sections under pages/home/)
    ├── components/       # UI components — see src/components/AGENTS.md
    ├── hooks/            # 18 hooks, ~10K lines, singleton state — see src/hooks/AGENTS.md
    ├── mockingbird/      # Alt UI (stock Spotify skin) — see src/mockingbird/AGENTS.md
    ├── contexts/         # SettingsContext, OTAContext, NotificationContext, VoiceContext
    ├── constants/fonts.js # createFontFace + all font configs (269 lines)
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

## ROUTING

**`BrowserRouter` is wrapped but no `<Route>` is declared anywhere.** It exists solely so descendants can call `useNavigate()`/`useNavigate` hooks from `react-router-dom`. Screen selection is an internal state machine driven by `App.jsx` props (`activeSection`, `viewingContent`, screen-visibility booleans) — don't add `<Route path=...>` expecting it to do anything.

## WHERE TO LOOK

| Task                                  | Location                                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Mount order / provider stack          | `src/App.jsx` bottom (last 100 lines)                                                                                           |
| Which screen renders when             | `src/App.jsx` content switch (~line 1226) + `mockingbirdSystemScreen`                                                           |
| Add/modify a daemon command           | `src/hooks/useNocturned.js` → `sendNocturneWsRequest()`                                                                         |
| Add/modify a Spotify command          | `src/hooks/useSpotifyWebSocket.js` → `sendSpotifyCommand()`                                                                     |
| Add a user setting                    | `src/contexts/SettingsContext.jsx` (localStorage-backed defaults table)                                                         |
| Add a font                            | `src/constants/fonts.js` + `public/fonts/` + `tailwind.config.js`                                                               |
| Toggle stock Spotify skin             | `mockingbirdUiEnabled` setting (gated in `UIShell.jsx`)                                                                         |
| Hardware-button preset long-press map | `src/hooks/useButtonMapping.jsx` + `App.jsx:useGlobalButtonMapping`                                                             |
| OTA update UX                         | `src/contexts/OTAContext.jsx` + `src/components/settings/SoftwareUpdate`                                                        |
| Icon library                          | `src/components/common/icons/index.jsx` (76 icons (75 original + `ShuffleActiveIcon` for voice confirmations), barrel exported) |
| Voice assistant overlay               | `src/components/common/overlays/voice/` + `src/contexts/VoiceContext.jsx`                                                       |

## CONVENTIONS

- **No TypeScript.** Every file is `.js`/`.jsx`. ESLint rule: `no-unused-vars` allows `^[A-Z_]` (unused Icon imports tolerated).
- **Formatter = Prettier defaults.** `.prettierrc` is intentionally empty. Run `bun run lint` (writes) or `bun run lint-check` (verifies). No ESLint fix step in package scripts.
- **Module-level singleton hooks:** `useNocturned`, `useSpotifyData`, `useSpotifyPlayerState`, `useSpotifyWebSocket` hold state in module scope with pub/sub. Do not "lift" into Context. See `src/hooks/AGENTS.md`.
- **All remote I/O via the daemon:** never `fetch('api.spotify.com/...')`. Calls go through `sendSpotifyCommand` → daemon → iAP2 → iPhone.
- **Image loading:** go through `SpotifyImage` / `useImageLoader`. Direct `<img src=spotify-cdn>` URLs bypass the daemon image proxy and flash on bad networks.
- **Global cross-UI handles:** `window.carThingRootStore` (mockingbird's MobX root), `window.testShelf`, etc. set by mockingbird for debugging and used sparingly by `App.jsx` for cross-UI toggles. Not a general-purpose globals pattern.
- **Headless UI:** modals/switches use `@headlessui/react` — do not roll your own focus traps.
- **Tailwind font stack:** `className="nocturne-font-stack"` or Tailwind `font-sans` — falls through 12 language variants via CSS vars. Don't inline `font-family`.
- **SCSS is mockingbird-only.** Main Nocturne UI uses Tailwind classes; never `import styles from './Foo.module.scss'` outside `src/mockingbird/`.
- **Voice overlay state lives in `src/contexts/VoiceContext.jsx`** (React Context + reducer, same pattern as SettingsContext/OTAContext/NotificationContext).

## ANTI-PATTERNS (THIS PROJECT)

- **Don't add `<Route>` declarations** — the Router is a shell for `useNavigate` only (see ROUTING above). App routing is a state machine in `App.jsx`.
- **Don't target modern Chrome features.** Build must work on Chrome 69 (the kiosk browser). Optional-chaining/nullish-coalesce are fine (legacy plugin transpiles), but avoid top-level-await, private class fields (`#foo`), dynamic import in hot paths, and CSS `inset:` (PostCSS plugin fixes most usages — do not rely on it for new code; write `top/right/bottom/left`).
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
bun run preview       # Serve the built bundle
bun run lint          # Prettier --write
bun run lint-check    # Prettier --check (CI)
```

**Dev → Car Thing:** edit `/etc/sv/chromium/run` on the device to point `--app=http://your-host:port`, then `sv restart chromium`. See README.md § Development.

## NOTES

- **No automated tests.** No unit-test runner and no integration tests. Manual QA only.
- **`public/fonts/` ships 18 woff2 files (~2MB)** — needed because the kiosk is offline-first. Don't trim without confirming.
- **`@tailwindcss/postcss` v4 is a devDep but the runtime is Tailwind 3.** The v4 package is vestigial/unused — don't migrate to v4 without a coordinated plan (mockingbird SCSS modules + Headless UI will need adjustments).
- **`react-transition-group@4.4.5` is pinned** for React 19 compat via `mockingbird/ui/components/CSSTransitionCompat.jsx`. Don't upgrade.
- **Legacy dev shim (`legacyDevTarget` in `vite.config.js`)** polyfills `Promise.allSettled`, `Object.fromEntries`, `String.prototype.replaceAll`, `performance.measure/mark` and retransforms every JS/TS asset to chrome69 at dev time. Production uses `@vitejs/plugin-legacy`.
