# HOOKS — CORE LOGIC LAYER

## OVERVIEW

18 custom hooks (9,716 lines total) forming the application's entire data/communication layer. All Spotify and daemon interaction flows through these hooks.

## ARCHITECTURE PATTERN

Unlike typical React hooks, the large hooks here use **module-level singleton state** with pub/sub:

```
// Module-level globals (shared across all component instances)
let globalWsRef = null;
const subscribers = new Set();

// Pub/sub pattern for cross-component state sharing
export const subscribeXxx = (listener) => { subscribers.add(listener); return () => subscribers.delete(listener); };
export const getXxxState = () => currentState;

// React hook wraps the singleton
export function useXxx() { ... }
```

This pattern exists in `useNocturned.js`, `useSpotifyData.js`, `useSpotifyPlayerState.js`, and `useSpotifyWebSocket.js`. It avoids React context re-render storms for high-frequency state (WebSocket messages, playback position, BT connection).

## HOOK INDEX

| Hook                          | Lines | Purpose                                                                                                                                                                                                                 |
| ----------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useNocturned.js`             | 1,995 | **Central hub**: daemon WebSocket singleton, Bluetooth management (discovery/pairing/connect/disconnect), system updates, app-ready state, auth state, network monitoring. Exports both hooks and standalone functions. |
| `useSpotifyData.js`           | 1,383 | Library data fetching: recents, playlists, artists, liked songs, radio mixes, shows. Caching, retry logic, initial data load coordination.                                                                              |
| `useSpotifyPlayerState.js`    | 1,255 | Player state machine: now-playing events, Dealer WebSocket integration, album change detection, device type tracking.                                                                                                   |
| `useSpotifyWebSocket.js`      | 1,003 | Spotify command layer: `sendSpotifyCommand()` with UUID-correlated request/response, image fetching, device management. Wraps `useNocturned` WebSocket.                                                                 |
| `useNavigation.js`            | 731   | Knob/keyboard/wheel navigation: item selection, scroll tracking, inactivity timeout, vertical/horizontal modes.                                                                                                         |
| `useImageLoader.js`           | 665   | Image preloading with canvas-based color extraction, caching, fade-in transitions.                                                                                                                                      |
| `useSpotifyPlayerControls.js` | 640   | Playback controls: play/pause/skip/seek/volume/shuffle/repeat. Volume queue processing, device switching, DJ mix support. Exports `DeviceSwitcherContext`.                                                              |
| `useGradientTransition.js`    | 470   | Album art → animated gradient background. Color extraction with canvas, smooth RGB interpolation, section-aware color schemes.                                                                                          |
| `useUpdateCheck.js`           | 321   | OTA update check/install flow via daemon API. Version comparison, download progress, reboot trigger.                                                                                                                    |
| `usePlaybackProgress.js`      | 298   | Client-side playback position interpolation. Tracks elapsed time between server updates, handles seek/pause/resume.                                                                                                     |
| `useLyrics.js`                | 263   | Lyrics fetch via Spotify command, time-synced highlighting, auto-scroll with manual scroll suspension.                                                                                                                  |
| `useSwiperNavigation.js`      | 238   | Swiper (horizontal carousel) knob/wheel selection: clamped index tracking, inactivity timeout, rapid-scroll detection. Exports `setDragging` module-level flag, `TRANSITION_DURATION_MS`, `EASING_FUNCTION`.            |
| `useButtonMapping.jsx`        | 146   | Hardware preset button long-press → map current content to button. localStorage persistence.                                                                                                                            |
| `useGestureControls.js`       | 145   | Touch gesture detection: swipe directions with scrollable container awareness, settings-gated.                                                                                                                          |
| `useCurrentTime.js`           | 98    | Clock display with timezone detection, 12/24h format from settings. Caches timezone.                                                                                                                                    |
| `useGradientState.js`         | 26    | Thin wrapper combining `useGradientTransition` state + updater for App.jsx.                                                                                                                                             |
| `useSubscription.js`          | 21    | Wraps `useNocturned` subscription state (subscribed bool + status).                                                                                                                                                     |
| `useElapsedTime.js`           | 18    | Formats milliseconds → "m:ss" display string.                                                                                                                                                                           |

## WHERE TO LOOK

| Task                       | Start here                                                          |
| -------------------------- | ------------------------------------------------------------------- |
| Add new daemon command     | `useNocturned.js` → `sendNocturneWsRequest()`                       |
| Add new Spotify command    | `useSpotifyWebSocket.js` → `sendSpotifyCommand()`                   |
| Debug WebSocket connection | `useNocturned.js` → `initializeWebSocket()`, reconnect logic        |
| Debug Bluetooth            | `useNocturned.js` → `useBluetooth()` hook, `handleBluetoothEvent()`. Reconnect chain is a **module-level singleton** (`attemptBtReconnect`, `handleBluetoothSingletonMessage`, `handleBluetoothSingletonOpen`) — exactly one chain regardless of how many components mount `useBluetooth()`. Backoff 2s → 60s, infinite retries (no max attempts cap). |
| Debug playback state       | `useSpotifyPlayerState.js` → `handleNowPlayingEvent()`              |
| Add new data source        | `useSpotifyData.js` → follow existing fetch pattern with retry      |
| Change navigation behavior | `useNavigation.js` — handles wheel, keyboard, selection             |

## CONVENTIONS

- **Standalone exports alongside hooks**: Large hooks export both `useXxx()` hooks and `getXxxState()`/`subscribeXxxState()` standalone functions for use outside React components
- **UUID-correlated requests**: All WebSocket requests use UUID message IDs with pending request maps for response matching
- **Retry with backoff**: Data fetching uses `MAX_RETRIES` + `RETRY_DELAY` constants, WebSocket reconnects use exponential backoff capped at 30s
- **Ref-heavy patterns**: Callbacks stored in refs to avoid stale closures in event listeners — standard pattern here, don't "simplify" to direct deps
- **No TypeScript**: All hooks are `.js` (plain logic) except `useButtonMapping.jsx` (contains JSX)
