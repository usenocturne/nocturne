# COMPONENTS — MAIN NOCTURNE UI WIDGETS

## OVERVIEW

All main-UI React components (mockingbird has its own tree). Entry-point screens are dispatched directly from `App.tsx`'s `content` switch; shared primitives live under `common/`.

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
│   │   └── voice/        # Voice-assistant overlay: VoiceBorder, VoicePill, VoiceConfirmation, VolumeConfirmation, VoiceOverlay, constants.ts
│   ├── GradientBackground.tsx  # Animated album-art gradient (fed by useGradientState)
│   ├── LockView.tsx            # Lock screen (right-most hardware button)
│   ├── ScrollingText.tsx       # Marquee when text overflows; can wrap selected text when trackNameScrollingEnabled is off
│   ├── SpotifyImage.tsx        # Image via daemon proxy — ALWAYS use instead of <img>
│   └── SubscriptionGate.tsx    # Renders children only if useSubscription().isSubscribed
├── content/ContentView.tsx     # Detail view for album/playlist/artist/show/mix/liked-songs
├── player/
│   ├── NowPlaying.tsx          # Fullscreen player (art, lyrics, controls, gestures)
│   ├── DeviceSwitcherModal.tsx # Device list + transfer (wraps DeviceSwitcherContext from hooks)
│   ├── PlaybackTimeLabel.tsx   # Elapsed / remaining / total (SettingsContext-gated)
│   ├── ProgressBar.tsx         # Seekable bar, dial-aware
│   └── VolumeOverlay.tsx       # Transient volume display on dial turn
├── screens/              # Full-screen top-level screens chosen by App.tsx
│   ├── SplashScreen.tsx        # Shown until app-ready
│   ├── AuthScreen.tsx          # QR login + subscription gate
│   ├── NetworkScreen.tsx       # Connection lost / reconnection UI
│   ├── PairingScreen.tsx       # BT pairing PIN confirm
│   └── QRCodeDisplay.tsx       # QR primitive (qrcode.react)
├── settings/
│   ├── Settings.tsx            # Settings shell (uses settingsStructure map)
│   ├── SoftwareUpdate.tsx      # The detailed OTA surface. OTAContext discovers automatically after initial data load, auto-installs only when Automatic Updates is enabled, preserves unapplied component presentation across kiosk reloads, clears a restored image target after the user's restart, and maps component completion to Reload and image completion to Restart. Daemon and combined bandaid Reload awaits `ota.activate` before clearing state or reloading; builtin webapp Reload never restarts the daemon.
│   ├── About.tsx               # Version / credits
│   └── network/BluetoothDevices.tsx  # BT pairing/connect UI (uses useBluetooth)
├── tutorial/
│   ├── Tutorial.tsx            # Onboarding step machine (main-UI flavor)
│   └── TutorialFrame.tsx       # Per-step frame renderer
└── voice/icons/          # EMPTY — legacy placeholder; main-UI voice UI lives in `common/overlays/voice/`. Mockingbird still owns its own voice UI at `src/mockingbird/ui/components/Listening/`.
```

## WHERE TO LOOK

| Task                           | Location                                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Add a new screen               | `screens/` + dispatch branch in `App.tsx` content switch                                                                                  |
| Add a sidebar section          | `common/navigation/Sidebar.tsx` + handle in Home/App                                                                                      |
| Add an icon                    | `common/icons/<Name>.tsx` + export from `icons/index.tsx`                                                                                 |
| Add a notification app icon    | `common/icons/NotificationAppIcons.tsx`; add verified artwork under `public/images/notification-apps/` and keep the unknown-app fallback  |
| Voice assistant overlay        | `common/overlays/voice/` + `contexts/VoiceContext.tsx`                                                                                    |
| Native phone incoming calls    | `common/overlays/call/IncomingCallOverlay.tsx` owns the Nocturne presentation; `hooks/usePhoneCalls.ts` owns shared lifecycle and actions |
| Global overlay (Power, BT map) | `common/overlays/` + wire in `App.tsx` bottom render                                                                                      |
| Gradient background tweaks     | `common/GradientBackground.tsx` + `hooks/useGradientState`                                                                                |
| Settings row                   | `settings/Settings.tsx` → `settingsStructure` object                                                                                      |
| Home view section              | `src/pages/home/<Name>Section.tsx` + `src/pages/Home.tsx`                                                                                 |

The main Settings factory-reset action sends one `device.factoryreset` request and lets the daemon own reboot.

## CONVENTIONS

- **Icons via barrel:** `import { CheckIcon } from "../common/icons";` — never deep-import a single icon file.
- **Notification app icons:** use the exact ANCS bundle identifier or Android package name in `NotificationAppIcons.tsx`, with platform-specific artwork when the apps differ. Do not resolve by display name or fetch icons at runtime. The updater stores App Store artwork as JPEG and Google Play artwork as PNG. `NotificationBanner` may render the checked-in local artwork directly and must retain the component-icon fallback on image failure.
- **Notification body text:** collapsed banners use 20px medium text, preserve line breaks, and wrap to two lines at a relaxed 27px line height. A 1px negative top-margin correction keeps the visible gaps between the title and both body lines equal. Tapping a longer body temporarily hides sibling banners and opens a hidden-scrollbar body viewport: three lines for known apps, or two when an unknown-app eyebrow is visible. Every individual banner, including its expanded state, has a hard 160px maximum so it never occupies more than one third of the 800×480 screen.
- **Registered notification presentation:** a resolved local `iconSrc` replaces the redundant app-name eyebrow. When that notification body renders across multiple lines, only its first visual line is bold. Unregistered apps keep the app name and medium body weight.
- **Notification surface:** banners use the large, centered, fully opaque Nocturne overlay surface with a 760px maximum width, solid hairline, deep shadow, shared `tracking-tight` notification text, and a 52px dismiss target. Keep the container click-through outside the cards and preserve the restrained reduced-motion-aware entrance. `NotificationBridge` uses `SettingsUpdateIcon` for connector and device update notices, deduplicates device releases, and keeps a dismissed release hidden until discovery changes.
- **No remote `<img>`:** use `SpotifyImage` (daemon proxy) or `useImageLoader` (preload + color extract) for remote images. Checked-in notification app artwork is the only direct `<img>` exception.
- **Fetched image strings:** convert daemon-returned strings through `imageDataStringToSource`. Only explicit app assets such as `/images/...`, remote URLs, and `data:` or `blob:` sources pass through. Bare JPEG base64 begins with `/9j/` and is not a local path.
- **Text overflow:** use `ScrollingText` — it respects the `trackNameScrollingEnabled` setting. For Now Playing titles, pass `multilineWhenDisabled` so disabling scrolling wraps the title across multiple lines instead of freezing a one-line marquee.
- **Content queue gesture:** `ContentView` track and episode rows own the swipe-left add-to-queue action. Keep the gesture scoped to this screen, preserve vertical list scrolling and tap-to-play, and show success only after `spotify.player.queue.add` resolves. Queue-specific motion in `index.css` keeps drag tracking immediate, adds post-threshold resistance and spring-like settling, and disables decorative motion for reduced-motion users.
- **`SubscriptionGate`** wraps premium-only UI; rely on it rather than inline `useSubscription()` checks so the fallback pattern stays consistent.
- **Hardware-button long-press:** `useGlobalButtonMapping` in `App.tsx` owns preset mapping flow; don't duplicate in screens.
- **Tutorial skip:** `Tutorial.tsx` owns the hidden Escape+4 hold shortcut. Keep it on the existing tutorial completion path so `hasSeenTutorial` and post-tutorial navigation stay in sync. After the hold threshold, keep capturing both keys until they are released before completing; otherwise Escape auto-repeat reaches the newly mounted Home and Now Playing handlers.
- **Phone volume overlay:** `phone.volume.update` carries phone system volume and should update `VolumeOverlay` immediately after the hidden startup baseline, including large jumps from volume-button holds. Do not show directional placeholder arrows for phone-media knob volume; wait for the reported phone volume.
- **Incoming call overlay:** This directory owns only the Nocturne presentation. Render complete merged call snapshots with `direction: incoming` and `status: ringing`, disable both actions after one is pressed, and wait for an iPhone lifecycle update before dismissing the surface. Mockingbird has a separate SCSS presentation but reuses the same top-level hook and actions.
- **Bluetooth pairing overlay:** `PairingScreen` is presentation-only and must remain a sibling above the current system screen. A PIN request must not replace or unmount a disconnected `NetworkScreen`, because its `BluetoothDevices` child owns the open pairing window needed by AccessorySetupKit's classic transport bridge.
- **Auth Bluetooth pairing:** The initial `AuthScreen` owns the pairing window from the QR screen while no known phone or `app.ready` session exists. Its nested `BluetoothDevices` acquires an overlapping lease while the explicit list is mounted, so the window stays open if the parent owner ends during a connection handoff. Subscription and post-setup auth screens remain closed until their explicit Bluetooth subpage is opened.
- **Phone presentation toggles:** General settings exposes Phone Calls and Phone Notifications. Both controls are disabled unless the user has verified strict Nocturne+ access, including verified admins, and a direct phone connection. The lock changes only effective presentation and preserves the saved preferences. Call presentation gates every modal side effect in `App.tsx`; notification presentation is filtered inside `NotificationBridge` so system notices remain visible.
- **Caller glyph:** The incoming-call screen uses a decorative Lucide `UserRound` placeholder because iAP2 call snapshots do not include contact artwork. Keep it hidden from assistive technology so it is never presented as verified caller identity.

## ANTI-PATTERNS

Now Playing quick-access binding must use `src/utils/spotifyContext.ts`. Do not add local fixed-position parsing for Spotify context URIs because Liked Songs and personalized yearly playlists have multiple valid identities.

Main Now Playing keeps phone-media progress mounted during the short interval between a track identity update and its first complete timing anchor. Render an unknown timeline as an empty bar with placeholder labels, and keep it disabled for seeking. Mockingbird other-media presentation intentionally has no progress bar and must not be changed as part of main-player timing work.

Main Now Playing may show lyrics for phone media and Spotify local files. Phone lines are presentation only and must not gain button roles, keyboard handlers, pointer affordances, or seek actions. Spotify local files use the normal synchronized-line seek behavior. Leave Mockingbird unchanged.

ContentView must keep Liked Songs quick-access binding active while its tracks are loading. Its identity, label, and artwork are static, and playback resolves the live profile-backed collection before falling back to saved track URIs.

- **Don't add new sidebar sections** without updating `Sidebar.tsx`, `Home.tsx`, and `App.tsx`'s `activeSection` logic together — they're tightly coupled.
- **Don't use `<Route>`.** The router has no routes (see root AGENTS.md § ROUTING). Screen selection is via `App.tsx` state.
- **Don't put voice UI under `components/voice/`** (dead placeholder). New voice UI lives under `components/common/overlays/voice/`. Mockingbird still owns its own voice UI at `src/mockingbird/ui/components/Listening/`.
- **Don't import from `src/mockingbird/`** (except the one allowed `LazyBTPairing` dynamic import in `App.tsx`). That skin is isolated.
- **Don't split `NowPlaying.tsx` / `ContentView.tsx` / `Settings.tsx` opportunistically** — the large sizes are intentional due to tightly coupled state/gesture/nav logic. Propose an RFC before refactoring.

- **Pairing code verification:** Both skins display the fresh matching code and direct the user to confirm on the other device. The Car Thing has no pairing buttons or code-entry fields. Preserve discovery owners, ignore stale cancellation scoped by `request_id`, and recover pending prompts through `bluetooth.pairing.pending` on socket reconnect. Historical prompts without request ids remain display-only.

`QRCodeDisplay.tsx` renders the supplied URI, loading state, or error. Its only caller supplies a stable app/deep link; it owns no polling timer or refresh callback.

Preset artwork in `ButtonMappingOverlay` uses `SpotifyImage` and the shared cancellable image queue. Refresh stored slot identities only while the overlay is open and retain state identity when nothing changed. Do not reintroduce a private blob cache or request polling driven by image state updates.

## Presentation contracts

Main UI props use component-specific interfaces and the shared playback, content, device, and settings models. Do not restore `UiComponentProps`, `UiLooseData`, or double assertions over hook return values. Preserve optional-field guards where provider metadata can omit identifiers, artwork, or counts.

`SwiperCarousel` is generic over its actual item type. Card keys prefer stable IDs or URIs and use an index only when neither exists. Saved podcast entries accept either the wrapped `show` or the flattened show metadata. `content/queueSwipe.ts` contains the checked gesture implementation and remains covered by the existing queue gesture tests.

Now Playing gets device listing and transfer operations from `useSpotifyWebSocket`. Its memo comparison preserves the stable playback-progress fields so position ticks continue through the progress subscription. Headless UI fragment menu items attach click handlers to their actual child element. Mockingbird's existing hardware event handler owns its short Settings-button press. The main App must not toggle the stock overlay a second time from its window capture listener. Do not invent a `uiState` store or a tethering flag absent from `useBluetooth`.

A terminal artwork failure is scoped to the current Spotify readiness period. When readiness returns, `SpotifyImage` must clear its local failed-URL marker as well as the queue failure marker so the same visible cover can retry without remounting.
