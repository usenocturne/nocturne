# MOCKINGBIRD — STOCK SPOTIFY CAR THING UI CLONE

## OVERVIEW

Alternative UI skin replicating the original Spotify Car Thing experience. Lazy-loaded via `UIShell.jsx` when `mockingbirdUiEnabled` setting is true. **Completely different architecture** from the main Nocturne UI: MobX stores, SCSS modules, Spotify Circular font.

## STRUCTURE

```
mockingbird/
├── UIShell.jsx                 # Gate: renders Nocturne children OR lazy-loads MockingbirdShell
└── ui/
    ├── MockingbirdShell.jsx    # Root: RootStore init, view routing, Settings overlay, playback polling
    ├── components/
    │   ├── Main.jsx            # Main view container (Npv, Shelf, Tracklist, Presets)
    │   ├── Views/              # Npv (now playing), Shelf (browse), Tracklist, Presets
    │   ├── Settings/           # MainMenu, Submenu, PhoneConnection
    │   ├── Setup/              # BTPairing, StartSetup, Connected, Welcome, LearnTactile
    │   ├── Onboarding/         # 18 onboarding step components
    │   ├── Icons/              # EncoreWeb + CarthingUIComponents icon sets
    │   ├── CarthingUIComponents/ # Banner, Button primitives
    │   ├── Modals/             # Modal components
    │   ├── CSSTransitionCompat.jsx # Transition wrapper
    │   └── DelayedRender.jsx   # Render delay utility
    ├── stores/                 # 17 MobX stores (see below)
    ├── hooks/                  # useCarThingSpotifyIntegration, useSwiperDial
    ├── eventhandlers/          # BackButton, Dial, Hardware, PresetButton, SettingsButton
    ├── helpers/                # HardwareEvents, utility functions
    ├── styles/                 # SCSS modules + Variables.js
    ├── contexts/               # CarThingStore (MobX provider)
    └── utils/                  # Shared utilities
```

## KEY DIFFERENCES FROM NOCTURNE UI

| Aspect           | Nocturne (main)                         | Mockingbird (this)                               |
| ---------------- | --------------------------------------- | ------------------------------------------------ |
| State management | React Context + module-level singletons | MobX stores (`RootStore` tree)                   |
| Styling          | Tailwind CSS                            | SCSS modules (`.module.scss`)                    |
| Font             | Inter + Noto Sans variants              | Spotify Circular (`spotify-circular`)            |
| Data flow        | Custom hooks → WebSocket                | `RootStore` → MobX reactions → stores            |
| Components       | Functional + hooks                      | Functional + `observer()` from `mobx-react-lite` |

## STORES

`RootStore` initializes all stores. Many are **stubs** (`stubs.js`) — empty MobX observables for interfaces the original Spotify code expected but Nocturne doesn't implement:

**Active stores**: `PlayerStore`, `ImageStore`, `ViewStore`, `ShelfStore`, `TracklistStore`, `QueueStore`, `PresetsStore`, `SettingsStore`, `BluetoothStore`, `PhoneConnectionStore`, `HardwareStore`, `OnboardingStore`, `BannerStore`

**Stubbed**: `NpvStore`, `VoiceStore`, `OtaStore`, `VolumeStore`, `RadioStore`, `SavedStore`, `TipsStore`, ~15 more in `stubs.js`

## CONVENTIONS

- **MobX observer pattern**: Components wrapped in `observer()` from `mobx-react-lite`
- **SCSS modules**: `import styles from './Foo.module.scss'` — NOT Tailwind
- **Store access**: Via `useContext(CarThingStoreContext)` → provides `RootStore`
- **Global store ref**: `window.carThingRootStore` set in `MockingbirdShell.jsx` for cross-UI access (Nocturne's `App.jsx` uses it for settings toggle)
- **Spotify Circular font**: Loaded via injected `<style>` tag in `MockingbirdShell.jsx`, not through `FontLoader`

## ANTI-PATTERNS

- **Don't mix Tailwind into mockingbird components** — use SCSS modules to match the original Spotify styling
- **Don't add new active stores** — if the original Spotify code didn't have it, stub it in `stubs.js`
- **Stubs must remain stubs** — they exist to satisfy MobX interface contracts, not to hold real data
- **Don't import mockingbird stores from main Nocturne code** — the only bridge is `window.carThingRootStore` and props passed through `UIShell`
