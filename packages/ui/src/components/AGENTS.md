# COMPONENTS — MAIN NOCTURNE UI WIDGETS

## OVERVIEW

All main-UI React components (mockingbird has its own tree). Entry-point screens are dispatched directly from `App.jsx`'s `content` switch; shared primitives live under `common/`.

## LAYOUT

```
components/
├── common/               # Shared primitives, overlays, navigation, modals
│   ├── icons/            # 76 icon components (75 original + `ShuffleActiveIcon`) + barrel (index.jsx)
│   ├── modals/           # DonationQRModal
│   ├── navigation/       # Sidebar, StatusBar, SwiperCarousel, Redirect
│   ├── notifications/    # NotificationBanner, NotificationsContainer, UpdateCheckNotification
│   ├── overlays/         # ButtonMappingOverlay, NetworkBanner, PowerMenuOverlay
│   │   └── voice/        # Voice-assistant overlay: VoiceBorder, VoicePill, VoiceConfirmation, VolumeConfirmation, VoiceOverlay, constants.js
│   ├── FontLoader.jsx    # Injects <style> with @font-face rules + document.fonts.load()
│   ├── GradientBackground.jsx  # Animated album-art gradient (fed by useGradientState)
│   ├── LockView.jsx            # Lock screen (right-most hardware button)
│   ├── ScrollingText.jsx       # Marquee when text overflows (gated by trackNameScrollingEnabled)
│   ├── SpotifyImage.jsx        # Image via daemon proxy — ALWAYS use instead of <img>
│   └── SubscriptionGate.jsx    # Renders children only if useSubscription().isSubscribed
├── content/ContentView.jsx     # 1237-line detail view for album/playlist/artist/show/mix/liked-songs
├── player/
│   ├── NowPlaying.jsx          # 1347-line fullscreen player (art, lyrics, controls, gestures)
│   ├── DeviceSwitcherModal.jsx # Device list + transfer (wraps DeviceSwitcherContext from hooks)
│   ├── PlaybackTimeLabel.jsx   # Elapsed / remaining / total (SettingsContext-gated)
│   ├── ProgressBar.jsx         # Seekable bar, dial-aware
│   └── VolumeOverlay.jsx       # Transient volume display on dial turn
├── screens/              # Full-screen top-level screens chosen by App.jsx
│   ├── SplashScreen.jsx        # Shown until app-ready
│   ├── AuthScreen.jsx          # QR login + subscription gate
│   ├── NetworkScreen.jsx       # Connection lost / reconnection UI
│   ├── PairingScreen.jsx       # BT pairing PIN confirm
│   └── QRCodeDisplay.jsx       # QR primitive (qrcode.react)
├── settings/
│   ├── Settings.jsx            # 1154-line settings shell (uses settingsStructure map)
│   ├── SoftwareUpdate.jsx      # OTA update flow (reads OTAContext, writes via useUpdateCheck)
│   ├── About.jsx               # Version / credits
│   └── network/BluetoothDevices.jsx  # BT pairing/connect UI (uses useBluetooth)
├── tutorial/
│   ├── Tutorial.jsx            # Onboarding step machine (main-UI flavor)
│   └── TutorialFrame.jsx       # Per-step frame renderer
└── voice/icons/          # EMPTY — legacy placeholder; main-UI voice UI lives in `common/overlays/voice/`. Mockingbird still owns its own voice UI at `src/mockingbird/ui/components/Listening/`.
```

## WHERE TO LOOK

| Task                           | Location                                                   |
| ------------------------------ | ---------------------------------------------------------- |
| Add a new screen               | `screens/` + dispatch branch in `App.jsx` content switch   |
| Add a sidebar section          | `common/navigation/Sidebar.jsx` + handle in Home/App       |
| Add an icon                    | `common/icons/<Name>.jsx` + export from `icons/index.jsx`  |
| Voice assistant overlay        | `common/overlays/voice/` + `contexts/VoiceContext.jsx`     |
| Global overlay (Power, BT map) | `common/overlays/` + wire in `App.jsx` bottom render       |
| Gradient background tweaks     | `common/GradientBackground.jsx` + `hooks/useGradientState` |
| Settings row                   | `settings/Settings.jsx` → `settingsStructure` object       |
| Home view section              | `src/pages/home/<Name>Section.jsx` + `src/pages/Home.jsx`  |

## CONVENTIONS

- **Icons via barrel:** `import { CheckIcon } from "../common/icons";` — never deep-import a single icon file.
- **No `<img>`:** use `SpotifyImage` (daemon proxy) or `useImageLoader` (preload + color extract).
- **Text overflow:** use `ScrollingText` — it respects the `trackNameScrollingEnabled` setting.
- **`SubscriptionGate`** wraps premium-only UI; rely on it rather than inline `useSubscription()` checks so the fallback pattern stays consistent.
- **Hardware-button long-press:** `useGlobalButtonMapping` in `App.jsx` owns preset mapping flow; don't duplicate in screens.

## ANTI-PATTERNS

- **Don't add new sidebar sections** without updating `Sidebar.jsx`, `Home.jsx`, and `App.jsx`'s `activeSection` logic together — they're tightly coupled.
- **Don't use `<Route>`.** The router has no routes (see root AGENTS.md § ROUTING). Screen selection is via `App.jsx` state.
- **Don't put voice UI under `components/voice/`** (dead placeholder). New voice UI lives under `components/common/overlays/voice/`. Mockingbird still owns its own voice UI at `src/mockingbird/ui/components/Listening/`.
- **Don't import from `src/mockingbird/`** (except the one allowed `LazyBTPairing` dynamic import in `App.jsx`). That skin is isolated.
- **Don't split `NowPlaying.jsx` / `ContentView.jsx` / `Settings.jsx` opportunistically** — the large sizes are intentional due to tightly coupled state/gesture/nav logic. Propose an RFC before refactoring.
