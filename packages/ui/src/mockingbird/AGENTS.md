# MOCKINGBIRD — STOCK SPOTIFY CAR THING UI CLONE

## OVERVIEW

Alternative UI skin replicating the original Spotify Car Thing experience. Lazy-loaded via `UIShell.jsx` when the `mockingbirdUiEnabled` setting is true. **Completely different architecture** from the main Nocturne UI: MobX stores, SCSS modules, Spotify Circular font. Ships alongside Nocturne's React/Tailwind app and shares only the daemon WebSocket (`sendNocturneWsRequest`) and the Spotify player-controls props passed through `UIShell`.

## STRUCTURE

```
mockingbird/
├── UIShell.jsx                 # Gate: renders Nocturne children OR lazy-loads MockingbirdShell (37 lines)
└── ui/
    ├── MockingbirdShell.jsx    # Root: RootStore init, view routing, Settings overlay, playback polling (496 lines)
    ├── components/
    │   ├── Main.jsx            # Main view container (mounts Views + Presets + overlays)
    │   ├── Views/              # AmbientBackdrop, Npv, Presets, Queue, Shelf, Tracklist + Views.jsx router
    │   ├── Listening/          # Voice assistant UI: Jellyfish, VoiceConfirmation, VolumeConfirmation, AutoSizingText, Listening.jsx (+ VoiceConfirmationActions/Intents)
    │   ├── Settings/           # Settings.jsx + subdirs: MainMenu, Submenu, DisplayAndBrightness, PhoneConnection, PhoneCalls, AirVentInterference, FactoryReset, RestartConfirm, Licenses, PowerTutorial, TipsOnDemand, UnavailableSettingBanner
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
    ├── contexts/CarThingStore.jsx  # React context wrapper around RootStore; instantiates the singleton `rootStore` and runs `useCarThingSpotifyIntegration` (105 lines)
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

## KEY DIFFERENCES FROM NOCTURNE UI

| Aspect           | Nocturne (main)                         | Mockingbird (this)                                                                                                                 |
| ---------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| State management | React Context + module-level singletons | MobX stores (`RootStore` tree)                                                                                                     |
| Styling          | Tailwind CSS                            | SCSS modules (`.module.scss`)                                                                                                      |
| Font             | Inter + Noto Sans variants              | Spotify Circular (`"Circular Sp UI v3 T"` — the typographic family fontconfig reports for `CircularSpUIv3T-{Book,Bold,Black}.ttf`) |
| Data flow        | Custom hooks → daemon WebSocket         | `RootStore` → MobX reactions; bridged from Nocturne props                                                                          |
| Components       | Functional + hooks                      | Functional + `observer()` from `mobx-react-lite`                                                                                   |
| Transitions      | Tailwind classes + CSS keyframes        | `CSSTransitionCompat.jsx` (react-transition-group wrapper)                                                                         |

## STORES

`RootStore` (`stores/RootStore.js`, 280 lines) instantiates everything. Many stores imported from `stubs.js` — empty/no-op MobX observables satisfying interfaces the original Spotify code expected but Nocturne doesn't implement.

**Active (real implementations)**: `PlayerStore`, `ImageStore`, `ViewStore`, `ShelfStore`, `TracklistStore`, `QueueStore`, `PresetsController` + `PresetsDataStore`, `SettingsStore`, `BluetoothStore`, `PhoneConnectionStore`, `HardwareStore`, `OnboardingStore`, `BannerStore`, `VoiceStore`, `UbiLogger`

**Stubbed (from `stubs.js`)**: `NpvStore`, `RemoteControlStore`, `WindLevelStore`, `OtaStore`, `SessionStateStore`, `TimerStore`, `DevOptionsStore`, `SetupStore`, `PermissionsStore`, `RemoteConfigStore`, `VolumeStore`, `RadioStore`, `ChildItemStore`, `HomeItemsStore`, `PodcastSpeedStore`, `PodcastStore`, `SavedStore`, `TipsStore`, `VersionStatusStore`, `SwipeDownHandleUiState`, `PhoneCallController`, `NightModeController`, `AirVentInterferenceController`, `PromoController`, `DisconnectedLogger`, `createOverlayController`

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

| Task                                  | Location                                                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Add a new view                        | `components/Views/` + register in `ViewStore` + `Views.jsx`                                                                                    |
| Change Nocturne → mockingbird mapping | `hooks/useCarThingSpotifyIntegration.js`                                                                                                       |
| Adjust dial/back/preset behavior      | `eventhandlers/*Handler.js` (wired in `RootStore.constructor` via `HardwareEventHandler.handleEvents`)                                         |
| Add/modify a setting                  | `components/Settings/<Section>/` + `SettingsStore`                                                                                             |
| Onboarding flow                       | `components/Onboarding/` + `OnboardingStore`                                                                                                   |
| Voice UI                              | `components/Listening/*` + `VoiceStore`                                                                                                        |
| Presets long-press mapping            | `PresetsStore` (`PresetsController` + `PresetsDataStore`)                                                                                      |
| Overlay (modal / banner) stack        | `components/Overlays/Overlay.jsx` + `createOverlayController` (stub) + `BannerStore`                                                           |
| Global store debug handles            | `RootStore.constructor` sets `window.carThingRootStore`, `window.testShelf`, `window.testPresets`, `window.showPresets`, `window.testHardware` |

## CONVENTIONS

- **MobX observer pattern**: Components wrapped in `observer()` from `mobx-react-lite`
- **SCSS modules only**: `import styles from './Foo.module.scss'` — NOT Tailwind
- **Store access**: `useCarThingStore()` from `contexts/CarThingStore.jsx` → returns the singleton `rootStore` (plus Nocturne-bridged fields: `spotifyData`, `currentPlayback`, `playerControls`, `playbackProgress`, `onSeek`)
- **Global store ref**: `window.carThingRootStore` set in `RootStore.constructor` for cross-UI access (Nocturne's `App.jsx` uses it for settings toggles)
- **Spotify Circular font**: Resolved by the real fontconfig family name **`"Circular Sp UI v3 T"`** (the typographic family on `CircularSpUIv3T-{Book,Bold,Black}.ttf` — name ID 16). The legacy alias `spotify-circular` is NOT a real family on the kiosk; the `@font-face` rules that used to inject that alias were removed when the kiosk was switched to system-installed fonts. No `@font-face` is shipped by the app — `public/fonts/CircularSp*.woff2` exist solely so developers can install the same fonts locally to preview the skin. The Latin-glyph file is what matters for rendering; the script-specific `CircularSp-{Arab,Cyrl,Deva,Grek,Hebr}` files have empty family names in their TTF/woff2 metadata and would need a kiosk-side fontconfig alias to be reachable from CSS.
- **React 19 transitions**: Use `CSSTransitionCompat.jsx` (wraps react-transition-group for strict mode / concurrent rendering)
- **Singleton RootStore**: Instantiated once at module load in `contexts/CarThingStore.jsx` — never construct another `RootStore`

## ANTI-PATTERNS

- **Don't mix Tailwind into mockingbird components** — use SCSS modules to match the original Spotify styling
- **Don't add new active stores** — if the original Spotify code didn't have it, stub it in `stubs.js`
- **Stubs must remain stubs** — they exist to satisfy MobX interface contracts, not to hold real data
- **Don't import mockingbird stores from main Nocturne code** — the only bridge is `window.carThingRootStore` and props passed through `UIShell`
- **Don't call the Spotify Web API directly** — go through `sendNocturneWsRequest` (daemon) or props bridged from Nocturne's hooks
- **Don't instantiate additional RootStores** — the singleton in `contexts/CarThingStore.jsx` is intentional (and stamps `window.carThingRootStore`)
