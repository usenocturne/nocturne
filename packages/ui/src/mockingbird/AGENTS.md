# MOCKINGBIRD — STOCK SPOTIFY CAR THING UI CLONE

## OVERVIEW

Alternative UI skin replicating the original Spotify Car Thing experience. Lazy-loaded via `UIShell.tsx` when the `mockingbirdUiEnabled` setting is true. **Completely different architecture** from the main Nocturne UI: MobX stores, SCSS modules, Spotify Circular font. Ships alongside Nocturne's React/Tailwind app and shares only the daemon WebSocket (`sendNocturneWsRequest`) and the Spotify player-controls props passed through `UIShell`.

## STRUCTURE

```
mockingbird/
├── UIShell.tsx                 # Gate for MockingbirdShell and its lazy global incoming-call presentation
└── ui/
    ├── MockingbirdShell.tsx    # Root: RootStore init, view routing, Settings overlay, playback polling
    ├── components/
    │   ├── Main.jsx            # Main view container (mounts Views + Presets + overlays)
    │   ├── Views/              # AmbientBackdrop, Npv, Presets, Queue, Shelf, Tracklist + Views.jsx router
    │   ├── Listening/          # Voice assistant UI: Jellyfish, VoiceConfirmation, VolumeConfirmation, AutoSizingText, Listening.jsx (+ VoiceConfirmationActions/Intents)
    │   ├── PhoneCall/          # Upstream-style incoming-call presentation driven by App's shared usePhoneCalls hook
    │   ├── Settings/           # Settings.jsx + subdirs including PhoneCalls and Notifications, backed by SettingsStore
    │   ├── Setup/              # BTPairing, StartSetup, ConnectionLost, SetupHelp, Setup.jsx
    │   ├── Onboarding/         # 10 step components (Start, LearnTactile, LearnVoice, LearnVoiceStep, DialPressPulse, DialTurnDots, BackPressBanner, SkipButton, NoInteractionModal, Onboarding.jsx)
    │   ├── Overlays/           # Overlay.jsx — overlay stack render (MobX-driven)
    │   ├── Modals/             # LoginRequired, SubscriptionRequired + Modal.module.scss
    │   ├── Icons/              # EncoreWeb (60) + CarthingUIComponents (46) icon sets
    │   ├── CarthingUIComponents/ # Banner, NowPlaying, Trailer, Type (low-level primitives) + index.js barrel
    │   ├── CSSTransitionCompat.jsx # React 19 compat wrapper around react-transition-group
    │   └── DelayedRender.jsx   # Delay-mount utility
    ├── stores/                 # 17 files — see STORES section
    ├── hooks/
    │   ├── useCarThingSpotifyIntegration.js  # Nocturne↔RootStore bridge: maps currentPlayback → PlayerStore, Shelf, etc. (754 lines)
    │   └── useSwiperDial.js                   # Swiper integration for rotary dial (42 lines)
    ├── eventhandlers/          # BackButton, Dial, Hardware, PresetButton, SettingsButton handlers (wire DOM events into MobX stores)
    ├── helpers/
    │   ├── HardwareEvents.js        # Kernel keycode → semantic event bus (312 lines)
    │   ├── voiceSearchNormalizer.js # Voice query cleanup (127 lines)
    │   ├── ImageSizeHelper.js       # Spotify image-size URL helper (39 lines)
    │   └── PointerListeners.js      # Passive touch/pointer helpers (11 lines)
    ├── styles/                 # SCSS modules + `Variables.js` (JS access to design tokens) + `variables.module.scss` (11K)
    ├── contexts/CarThingStore.tsx  # React context wrapper around RootStore; instantiates the singleton `rootStore` and runs `useCarThingSpotifyIntegration`
    └── utils/                  # colorExtractor.js, imageProxy.js
```

## DATA FLOW

```
Nocturne App.jsx
  └─ SettingsContext.mockingbirdUiEnabled === true
      └─ UIShell → React.lazy(MockingbirdShell)
          ├─ CarThingStoreProvider (singleton RootStore)
          │   └─ useCarThingSpotifyIntegration(rootStore, currentPlayback, playerControls)
          │       └─ mutates PlayerStore / ShelfStore / TracklistStore from Nocturne props
          ├─ usePlaybackPolling → sendNocturneWsRequest("spotify.player.state", ...) every 3s when no parent playback
          └─ Views.jsx routes based on ViewStore.currentView
```

Spotify data enters via two channels only: (1) props passed from Nocturne (`currentPlayback`, `playerControls`, `spotifyData`) and (2) `sendNocturneWsRequest` from `useNocturned`. There is no direct Spotify Web API access from mockingbird.

The parent Nocturne hook is the only owner of initial Spotify library loading, and Mockingbird consumes that `spotifyData` prop rather than issuing a second startup batch. When this skin is enabled, the parent prefetches up to 50 playlists, 20 artists, and 20 shows so the shelf's More categories have inventory without depending on hidden Nocturne section navigation. Its playback polling fallback waits for `app.ready`. A Bluetooth connection can precede the usable companion route during first-time iOS pairing, so it is not an RPC readiness signal.

Artist tracklists request `spotify.artist.top_tracks` with `mockingbird: true`. Companion implementations use this flag to retain or enrich each track's album metadata, which supplies the album subtitle and artwork in the artist view. Keep the flag in the canonical wire schema so daemon request normalization does not remove it. Spotify can still return an album URI with an empty name for releases outside the artist's discography response, so `TracklistStore` backfills only those missing albums through `spotify.album.get`.

## KEY DIFFERENCES FROM NOCTURNE UI

| Aspect           | Nocturne (main)                         | Mockingbird (this)                                                                                                                 |
| ---------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| State management | React Context + module-level singletons | MobX stores (`RootStore` tree)                                                                                                     |
| Styling          | Tailwind CSS                            | SCSS modules (`.module.scss`)                                                                                                      |
| Font             | Inter + Noto Sans variants              | Spotify Circular (`"Circular Sp UI v3 T"`; kiosk fontconfig registers the Latin and script-specific Book/Bold files as one family) |
| Data flow        | Custom hooks → daemon WebSocket         | `RootStore` → MobX reactions; bridged from Nocturne props                                                                          |
| Components       | Functional + hooks                      | Functional + `observer()` from `mobx-react-lite`                                                                                   |
| Transitions      | Tailwind classes + CSS keyframes        | `CSSTransitionCompat.jsx` (react-transition-group wrapper)                                                                         |

## STORES

`RootStore` (`stores/RootStore.ts`) instantiates everything. Many stores imported from `stubs.ts` are empty MobX observables satisfying interfaces the original Spotify code expected but Nocturne does not implement.

**Active (real implementations)**: `PlayerStore`, `ImageStore`, `ViewStore`, `ShelfStore`, `TracklistStore`, `QueueStore`, `PresetsController` + `PresetsDataStore`, `SettingsStore`, `BluetoothStore`, `PhoneConnectionStore`, `HardwareStore`, `OnboardingStore`, `BannerStore`, `VoiceStore`, `UbiLogger`, `NightModeController`, `WindLevelStore`, `AirVentInterferenceController`

**Stubbed (from `stubs.ts`)**: `NpvStore`, `RemoteControlStore`, `OtaStore`, `SessionStateStore`, `TimerStore`, `DevOptionsStore`, `SetupStore`, `PermissionsStore`, `RemoteConfigStore`, `VolumeStore`, `RadioStore`, `ChildItemStore`, `HomeItemsStore`, `PodcastSpeedStore`, `PodcastStore`, `SavedStore`, `TipsStore`, `VersionStatusStore`, `SwipeDownHandleUiState`, `PhoneCallController`, `PromoController`, `DisconnectedLogger`, `createOverlayController`

Night Mode consumes only the daemon's normalized `ambient_light_update.normalized_value` field. Do not use the raw sensor `value`, which has the opposite polarity. The stock curve is `round2(1.70 - 0.014 * darkness)` with no JavaScript clamp. CSS clamps the rendered opacity. The persisted key is `night_mode_user_enabled`; disabling it substitutes the stock producer-side darkness value `0` before applying the same curve. While `MockingbirdShell` is mounted, the opacity applies once to the whole document body over a transparent body and Spotify's `#282828` page background. This includes React body portals and prevents Nocturne's album gradient from showing through black Mockingbird surfaces. Every opacity change uses the stock 1000 ms `cubic-bezier(0.16, 1, 0.3, 1)` transition. Unmounting Mockingbird removes the document scope, so the saved preference never dims the Nocturne UI.

Air Vent Interference consumes `wind_level` events and alerts only when the level crosses from below 3 to level 3 or higher. The banner overlays Now Playing without unmounting it, remains visible while the debounced wind level is 3 or higher, and clears only when the level falls below 3. The banner is effective only while `CarThingStoreProvider` is mounted and cannot appear in the main Nocturne UI. Automatic removal does not write the dismissal key, so another threshold crossing can alert again. `wind_noise_alert_disabled` suppresses the banner but not the wind icon. `wind_noise_alert_dismissed-date` suppresses the banner for 24 hours. Muting the microphone hides both the icon and banner.

Largest real stores by size: `TracklistStore` (28K), `ShelfStore` (24K — drives `Shelf` view), `VoiceStore` (18K — voice assistant flow), `SettingsStore` (17K), `PresetsStore` (15K).

## VOICE RESULTS FLOW

The voice assistant (triggered by wake word on daemon side) surfaces UI through this chain:

```
daemon → WebSocket event → useNocturned → VoiceStore (mockingbird)
  └─ VoiceStore.queryResolved → components/Listening/Listening.jsx (observer)
      ├─ Jellyfish.jsx         # Animated listening orb
      ├─ VoiceConfirmation.jsx # "Playing X by Y" confirmation
      └─ VolumeConfirmation.jsx
  └─ VoiceStore.intent → ShelfStore / TracklistStore updates (play/queue/search)
```

`VoiceConfirmationActions.js` + `VoiceConfirmationIntents.js` define the intent taxonomy. `helpers/voiceSearchNormalizer.js` normalizes raw transcripts before dispatch.

## WHERE TO LOOK

| Task                                  | Location                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add a new view                        | `components/Views/` + register in `ViewStore` + `Views.jsx`                                                                                                   |
| Change Nocturne → mockingbird mapping | `hooks/useCarThingSpotifyIntegration.js`                                                                                                                      |
| Adjust dial/back/preset behavior      | `eventhandlers/*Handler.js` (wired in `RootStore.constructor` via `HardwareEventHandler.handleEvents`)                                                        |
| Add/modify a setting                  | `components/Settings/<Section>/` + `SettingsStore`                                                                                                            |
| Onboarding flow                       | `components/Onboarding/` + `OnboardingStore`                                                                                                                  |
| Voice UI                              | `components/Listening/*` + `VoiceStore`                                                                                                                       |
| Native phone incoming-call UI         | `components/PhoneCall/MockingbirdIncomingCallOverlay.tsx`; selected globally through `UIShell.tsx` and driven by App's single `usePhoneCalls` instance        |
| Presets long-press mapping            | `PresetsStore` (`PresetsController` + `PresetsDataStore`); storage is device-scoped through `src/utils/presetStorage.ts` using `lastConnectedBluetoothDevice` |
| Overlay (modal / banner) stack        | `components/Overlays/Overlay.jsx` + `createOverlayController` (stub) + `BannerStore`                                                                          |
| Global store debug handles            | `RootStore.constructor` sets `window.carThingRootStore`, `window.testShelf`, `window.testPresets`, `window.showPresets`, `window.testHardware`                |

## CONVENTIONS

- **MobX observer pattern**: Components wrapped in `observer()` from `mobx-react-lite`
- **SCSS modules only**: `import styles from './Foo.module.scss'` — NOT Tailwind
- **Store access**: `useCarThingStore()` from `contexts/CarThingStore.tsx` returns the singleton `rootStore` (plus Nocturne-bridged fields: `spotifyData`, `currentPlayback`, `playerControls`, `playbackProgress`, `onSeek`)
- **Preset persistence is per paired phone:** Mockingbird preset slots are stored under `mockingbird_presets:<bluetooth-address>` through `src/utils/presetStorage.ts`. Do not read or write the legacy global `nocturne_presets` key directly.
- **Global store ref**: `window.carThingRootStore` set in `RootStore.constructor` for cross-UI access (Nocturne's `App.jsx` uses it for settings toggles)
- **Spotify Circular font**: Resolved by the fontconfig family **`"Circular Sp UI v3 T"`**. The Latin files carry that typographic family, while the script-specific `CircularSp-{Arab,Cyrl,Deva,Grek,Hebr}` files have unusable embedded family names. The image's `75-nocturne-circular.conf` assigns every script-specific Book/Bold file to the same family at scan time, allowing Blink to select Arabic, Cyrillic, Devanagari, Greek, and Hebrew glyphs from the existing Mockingbird CSS family. Mockingbird requests only weights 400 and 700, so Black files are intentionally excluded. The legacy alias `spotify-circular` is not a real kiosk family, and the app ships no `@font-face` rules or font binaries.
- **React 19 transitions**: Use `CSSTransitionCompat.jsx` (wraps react-transition-group for strict mode / concurrent rendering)
- **Singleton RootStore**: Instantiated once at module load in `contexts/CarThingStore.jsx` — never construct another `RootStore`
- **Incoming phone calls:** Keep `PhoneCallController` stubbed. `App.tsx` owns the only `usePhoneCalls` subscription and selects this skin's presentation through `UIShell.tsx`. The call modal suspends Mockingbird hardware listeners so hidden views cannot react beneath it.
- **Phone display preferences:** Main `SettingsContext` remains the persisted source for call and notification presentation. Verified strict Nocturne+ access includes verified admins, while missing verification and lifetime-only access stay locked. `CarThingStoreProvider` mirrors those values and the presentation lock into `SettingsStore`, which owns Mockingbird touch and dial interactions. A lock keeps the saved preferences unchanged while showing both effective toggles as off. Touch and dial feedback must resolve the live upstream `lockedMessage` through `SettingsStore`, not cache it on menu rows, so MobX copies cannot make Nocturne+ and direct-phone restrictions disagree. Do not add a second localStorage implementation.

## ANTI-PATTERNS

- **Don't mix Tailwind into mockingbird components** — use SCSS modules to match the original Spotify styling
- **Do not add new active stores** unless the original Spotify code had the same store and behavior. Otherwise, add an interface stub in `stubs.ts`.
- **Stubs must remain stubs** because they satisfy MobX interface contracts and must not become unrelated data stores.
- **Don't import mockingbird stores from main Nocturne code** — the only bridge is `window.carThingRootStore` and props passed through `UIShell`
- **Don't call the Spotify Web API directly** — go through `sendNocturneWsRequest` (daemon) or props bridged from Nocturne's hooks
- **Don't instantiate additional RootStores** — the singleton in `contexts/CarThingStore.jsx` is intentional (and stamps `window.carThingRootStore`)
