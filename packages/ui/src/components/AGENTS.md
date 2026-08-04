# COMPONENTS — MAIN NOCTURNE UI WIDGETS

## OVERVIEW

All main-UI React components (mockingbird has its own tree). Entry-point screens are dispatched directly from `App.jsx`'s `content` switch; shared primitives live under `common/`.

## LAYOUT

```
components/
├── common/               # Shared primitives, overlays, navigation, modals
│   ├── icons/            # Shared icons, offline notification artwork catalog, and barrel (index.tsx)
│   ├── modals/           # DonationQRModal
│   ├── navigation/       # Sidebar, StatusBar, SwiperCarousel, Redirect
│   ├── notifications/    # NotificationBridge normalizes daemon/ANCS events; NotificationBanner and NotificationsContainer render the bounded global overlay
│   ├── overlays/         # ButtonMappingOverlay, NetworkBanner, PowerMenuOverlay
│   │   ├── call/         # Full-screen native phone incoming call surface
│   │   └── voice/        # Voice-assistant overlay: VoiceBorder, VoicePill, VoiceConfirmation, VolumeConfirmation, VoiceOverlay, constants.js
│   ├── GradientBackground.jsx  # Animated album-art gradient (fed by useGradientState)
│   ├── LockView.jsx            # Lock screen (right-most hardware button)
│   ├── ScrollingText.jsx       # Marquee when text overflows; can wrap selected text when trackNameScrollingEnabled is off
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
│   ├── SoftwareUpdate.tsx      # The detailed OTA surface. OTAContext discovers automatically after initial data load, auto-installs only when Automatic Updates is enabled, preserves unapplied component presentation across kiosk reloads, clears a restored image target after the user's restart, and maps component completion to Reload and image completion to Restart.
│   ├── About.jsx               # Version / credits
│   └── network/BluetoothDevices.jsx  # BT pairing/connect UI (uses useBluetooth)
├── tutorial/
│   ├── Tutorial.jsx            # Onboarding step machine (main-UI flavor)
│   └── TutorialFrame.jsx       # Per-step frame renderer
└── voice/icons/          # EMPTY — legacy placeholder; main-UI voice UI lives in `common/overlays/voice/`. Mockingbird still owns its own voice UI at `src/mockingbird/ui/components/Listening/`.
```

## WHERE TO LOOK

| Task                           | Location                                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Add a new screen               | `screens/` + dispatch branch in `App.jsx` content switch                                                                                  |
| Add a sidebar section          | `common/navigation/Sidebar.jsx` + handle in Home/App                                                                                      |
| Add an icon                    | `common/icons/<Name>.tsx` + export from `icons/index.tsx`                                                                                 |
| Add a notification app icon    | `common/icons/NotificationAppIcons.tsx`; add verified artwork under `public/images/notification-apps/` and keep the unknown-app fallback  |
| Voice assistant overlay        | `common/overlays/voice/` + `contexts/VoiceContext.jsx`                                                                                    |
| Native phone incoming calls    | `common/overlays/call/IncomingCallOverlay.tsx` owns the Nocturne presentation; `hooks/usePhoneCalls.ts` owns shared lifecycle and actions |
| Global overlay (Power, BT map) | `common/overlays/` + wire in `App.jsx` bottom render                                                                                      |
| Gradient background tweaks     | `common/GradientBackground.jsx` + `hooks/useGradientState`                                                                                |
| Settings row                   | `settings/Settings.jsx` → `settingsStructure` object                                                                                      |
| Home view section              | `src/pages/home/<Name>Section.jsx` + `src/pages/Home.jsx`                                                                                 |

## CONVENTIONS

- **Icons via barrel:** `import { CheckIcon } from "../common/icons";` — never deep-import a single icon file.
- **Notification app icons:** use the exact ANCS bundle identifier or Android package name in `NotificationAppIcons.tsx`, with platform-specific artwork when the apps differ. Do not resolve by display name or fetch icons at runtime. The updater stores App Store artwork as JPEG and Google Play artwork as PNG. `NotificationBanner` may render the checked-in local artwork directly and must retain the component-icon fallback on image failure.
- **Notification body text:** collapsed banners use 20px medium text, preserve line breaks, and wrap to two lines at a relaxed 27px line height. A 1px negative top-margin correction keeps the visible gaps between the title and both body lines equal. Tapping a longer body temporarily hides sibling banners and opens a hidden-scrollbar body viewport: three lines for known apps, or two when an unknown-app eyebrow is visible. Every individual banner, including its expanded state, has a hard 160px maximum so it never occupies more than one third of the 800×480 screen.
- **Registered notification presentation:** a resolved local `iconSrc` replaces the redundant app-name eyebrow. When that notification body renders across multiple lines, only its first visual line is bold. Unregistered apps keep the app name and medium body weight.
- **Notification surface:** banners use the large, centered, fully opaque Nocturne overlay surface with a 760px maximum width, solid hairline, deep shadow, shared `tracking-tight` notification text, and a 52px dismiss target. Keep the container click-through outside the cards and preserve the restrained reduced-motion-aware entrance. `NotificationBridge` uses `SettingsUpdateIcon` for connector and device update notices, deduplicates device releases, and keeps a dismissed release hidden until discovery changes.
- **No remote `<img>`:** use `SpotifyImage` (daemon proxy) or `useImageLoader` (preload + color extract) for remote images. Checked-in notification app artwork is the only direct `<img>` exception.
- **Text overflow:** use `ScrollingText` — it respects the `trackNameScrollingEnabled` setting. For Now Playing titles, pass `multilineWhenDisabled` so disabling scrolling wraps the title across multiple lines instead of freezing a one-line marquee.
- **Content queue gesture:** `ContentView` track and episode rows own the swipe-left add-to-queue action. Keep the gesture scoped to this screen, preserve vertical list scrolling and tap-to-play, and show success only after `spotify.player.queue.add` resolves. Queue-specific motion in `index.css` keeps drag tracking immediate, adds post-threshold resistance and spring-like settling, and disables decorative motion for reduced-motion users.
- **`SubscriptionGate`** wraps premium-only UI; rely on it rather than inline `useSubscription()` checks so the fallback pattern stays consistent.
- **Hardware-button long-press:** `useGlobalButtonMapping` in `App.jsx` owns preset mapping flow; don't duplicate in screens.
- **Tutorial skip:** `Tutorial.jsx` owns the hidden Escape+4 hold shortcut. Keep it on the existing tutorial completion path so `hasSeenTutorial` and post-tutorial navigation stay in sync. After the hold threshold, keep capturing both keys until they are released before completing; otherwise Escape auto-repeat reaches the newly mounted Home and Now Playing handlers.
- **Phone volume overlay:** `phone.volume.update` carries phone system volume and should update `VolumeOverlay` immediately after the hidden startup baseline, including large jumps from volume-button holds. Do not show directional placeholder arrows for phone-media knob volume; wait for the reported phone volume.
- **Incoming call overlay:** This directory owns only the Nocturne presentation. Render complete merged call snapshots with `direction: incoming` and `status: ringing`, disable both actions after one is pressed, and wait for an iPhone lifecycle update before dismissing the surface. Mockingbird has a separate SCSS presentation but reuses the same top-level hook and actions.
- **Bluetooth pairing overlay:** `PairingScreen` is presentation-only and must remain a sibling above the current system screen. A PIN request must not replace or unmount a disconnected `NetworkScreen`, because its `BluetoothDevices` child owns the open pairing window needed by AccessorySetupKit's classic transport bridge.
- **Auth Bluetooth pairing:** The initial `AuthScreen` owns the pairing window from the QR screen while no known phone or `app.ready` session exists. Its nested `BluetoothDevices` acquires an overlapping lease while the explicit list is mounted, so the window stays open if the parent owner ends during a connection handoff. Subscription and post-setup auth screens remain closed until their explicit Bluetooth subpage is opened.
- **Phone presentation toggles:** General settings exposes Phone Calls and Phone Notifications. Both controls are disabled unless the user has verified strict Nocturne+ access, including verified admins, and a direct phone connection. The lock changes only effective presentation and preserves the saved preferences. Call presentation gates every modal side effect in `App.tsx`; notification presentation is filtered inside `NotificationBridge` so system notices remain visible.
- **Caller glyph:** The incoming-call screen uses a decorative Lucide `UserRound` placeholder because iAP2 call snapshots do not include contact artwork. Keep it hidden from assistive technology so it is never presented as verified caller identity.

## ANTI-PATTERNS

- **Don't add new sidebar sections** without updating `Sidebar.jsx`, `Home.jsx`, and `App.jsx`'s `activeSection` logic together — they're tightly coupled.
- **Don't use `<Route>`.** The router has no routes (see root AGENTS.md § ROUTING). Screen selection is via `App.jsx` state.
- **Don't put voice UI under `components/voice/`** (dead placeholder). New voice UI lives under `components/common/overlays/voice/`. Mockingbird still owns its own voice UI at `src/mockingbird/ui/components/Listening/`.
- **Don't import from `src/mockingbird/`** (except the one allowed `LazyBTPairing` dynamic import in `App.jsx`). That skin is isolated.
- **Don't split `NowPlaying.jsx` / `ContentView.jsx` / `Settings.jsx` opportunistically** — the large sizes are intentional due to tightly coupled state/gesture/nav logic. Propose an RFC before refactoring.
