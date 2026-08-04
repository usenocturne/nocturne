import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { BrowserRouter as Router } from "react-router-dom";
import Home from "./pages/Home";
import GradientBackground from "./components/common/GradientBackground";
import { useGradientState } from "./hooks/useGradientState";
import { DeviceSwitcherContext } from "./hooks/useSpotifyPlayerControls";
import {
  useBluetooth,
  useSystemUpdate,
  useNocturneInfo,
  useNocturned,
  sendNocturneWsRequest,
  subscribeAppReadyState,
  subscribeSpotifySkippedState,
  getBluetoothPresentationState,
} from "./hooks/useNocturned";
import { useSpotifyData } from "./hooks/useSpotifyData";
import { usePlaybackProgress } from "./hooks/usePlaybackProgress";
import { SettingsProvider, useSettings } from "./contexts/SettingsContext";
import { OTAProvider } from "./contexts/OTAContext";
import React from "react";
import {
  NotificationProvider,
  useNotifications,
} from "./contexts/NotificationContext";
import { VoiceProvider, useVoice } from "./contexts/VoiceContext";
import NotificationBridge from "./components/common/notifications/NotificationBridge";
import {
  getActivePresetDeviceId,
  getButtonMappingValue,
} from "./utils/presetStorage";
import { selectPresentedPhoneCall, usePhoneCalls } from "./hooks/usePhoneCalls";
import SplashScreen from "./components/screens/SplashScreen";
import UIShell, { MockingbirdPhoneCallOverlay } from "./mockingbird/UIShell";
import { useSubscription } from "./hooks/useSubscription";
import type {
  ActiveSection,
  BluetoothDevice,
  ContentType,
  PairingRequest,
  SpotifyPlayback,
  UnknownRecord,
  ViewingContent,
  WsMessage,
} from "./types";

type PlayTrack = (
  trackUri?: string | null,
  contextUri?: string | null,
  uris?: string[] | null,
  deviceId?: string | null,
) => Promise<boolean>;

type GlobalButtonMappingOptions = {
  playTrack: PlayTrack;
  playDJMix?: (deviceId?: string | null) => Promise<boolean>;
  refreshPlaybackState: (forceRefresh?: boolean) => void | Promise<void>;
  setActiveSection: (section: ActiveSection) => void;
  isTutorialActive: boolean;
  isDisabled?: boolean;
  currentPlayback: SpotifyPlayback | null;
  spotifyUserId?: string | null;
};

interface BluetoothHookState {
  devices: BluetoothDevice[];
  pairingRequest: PairingRequest | null;
  isConnecting: boolean;
  showTetheringScreen: boolean;
  lastConnectedDevice: BluetoothDevice | null;
  connectedDevices: BluetoothDevice[];
  activeSessionDevices: BluetoothDevice[];
  isReconnectPending: boolean;
  hasFetchedInitialDevices: boolean;
  acceptPairing: () => Promise<void>;
  denyPairing: () => Promise<void>;
  disconnectDevice: (address: string) => void | Promise<void>;
  enableNetworking: () => void | Promise<void>;
  stopRetrying: () => void;
}

interface DeviceSwitcherIntent {
  trackUriToPlay?: string | null;
  contextUriToPlay?: string | null;
  urisToPlay?: string[] | null;
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const toRecord = (value: unknown): UnknownRecord | null =>
  value && typeof value === "object" ? (value as UnknownRecord) : null;

const LazyBTPairing = React.lazy(
  () => import("./mockingbird/ui/components/Setup/BTPairing"),
);
const LazyTutorial = React.lazy(() => import("./components/tutorial/Tutorial"));
const LazyContentView = React.lazy(
  () => import("./components/content/ContentView"),
);
const LazyNowPlaying = React.lazy(
  () => import("./components/player/NowPlaying"),
);
const LazyDeviceSwitcherModal = React.lazy(
  () => import("./components/player/DeviceSwitcherModal"),
);
const LazyButtonMappingOverlay = React.lazy(
  () => import("./components/common/overlays/ButtonMappingOverlay"),
);
const LazyNotificationsContainer = React.lazy(
  () => import("./components/common/notifications/NotificationsContainer"),
);
const LazyPairingScreen = React.lazy(
  () => import("./components/screens/PairingScreen"),
);
const LazyLockView = React.lazy(() => import("./components/common/LockView"));
const LazyPowerMenuOverlay = React.lazy(
  () => import("./components/common/overlays/PowerMenuOverlay"),
);
const LazyVoiceOverlay = React.lazy(
  () => import("./components/common/overlays/voice/VoiceOverlay"),
);
const LazyIncomingCallOverlay = React.lazy(
  () => import("./components/common/overlays/call/IncomingCallOverlay"),
);
const LazyNetworkScreen = React.lazy(
  () => import("./components/screens/NetworkScreen"),
);
const LazyNetworkBanner = React.lazy(
  () => import("./components/common/overlays/NetworkBanner"),
);
const LazyAuthScreen = React.lazy(
  () => import("./components/screens/AuthScreen"),
);

const IDLE_LOCK_MS = 5 * 60 * 1000;
const DISPLAY_IDLE_SLEEP_MS = 20 * 60 * 1000;
const DISPLAY_SLEEP_REQUEST_TIMEOUT_MS = 5000;
const DISPLAY_WAKE_INPUT_SUPPRESS_MS = 700;

function MockingbirdPairingOverlay({ pin }: { pin: string }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        fontFamily:
          "'Circular Sp UI v3 T', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <React.Suspense fallback={null}>
        <LazyBTPairing pin={pin} />
      </React.Suspense>
    </div>
  );
}

function ScreenFallback() {
  return (
    <div
      className="flex min-h-screen items-center justify-center"
      role="status"
      aria-label="Loading"
    >
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-white/80" />
    </div>
  );
}

function DeferredVoiceOverlay() {
  const { state } = useVoice();
  const [hasOpened, setHasOpened] = useState(false);

  useEffect(() => {
    if (state.isOpen) {
      setHasOpened(true);
    }
  }, [state.isOpen]);

  if (!state.isOpen && !hasOpened) return null;

  return (
    <React.Suspense fallback={null}>
      <LazyVoiceOverlay />
    </React.Suspense>
  );
}

function DeferredNotificationsContainer() {
  const { notifications } = useNotifications();

  if (notifications.length === 0) return null;

  return (
    <React.Suspense fallback={null}>
      <LazyNotificationsContainer />
    </React.Suspense>
  );
}

function useGlobalButtonMapping({
  playTrack,
  playDJMix,
  refreshPlaybackState,
  setActiveSection,
  isTutorialActive,
  isDisabled = false,
  currentPlayback,
  spotifyUserId,
}: GlobalButtonMappingOptions) {
  const [showMappingOverlay, setShowMappingOverlay] = useState(false);
  const [activeButton, setActiveButton] = useState<string | null>(null);
  const [isProcessingButtonPress, setIsProcessingButtonPress] = useState(false);
  const ignoreNextReleaseRef = useRef(false);
  const shouldRenderRef = useRef(true);

  const handleButtonPress = useCallback(
    async (buttonNumber: string) => {
      if (isProcessingButtonPress || isTutorialActive || isDisabled) return;

      const deviceId = getActivePresetDeviceId();
      const mappedId = getButtonMappingValue(buttonNumber, "Id", deviceId);
      const mappedType = getButtonMappingValue(buttonNumber, "Type", deviceId);

      if (!mappedId || !mappedType) return;

      setIsProcessingButtonPress(true);
      setActiveButton(buttonNumber);
      setShowMappingOverlay(true);

      let contextUri: string | null = null;
      let uris: string[] | null = null;

      try {
        if (mappedType === "album") {
          contextUri = `spotify:album:${mappedId}`;
        } else if (mappedType === "playlist") {
          contextUri = `spotify:playlist:${mappedId}`;
        } else if (mappedType === "artist") {
          contextUri = `spotify:artist:${mappedId}`;
        } else if (mappedType === "show") {
          contextUri = `spotify:show:${mappedId}`;
        } else if (mappedType === "mix") {
          const mixTracksJson = getButtonMappingValue(
            buttonNumber,
            "Tracks",
            deviceId,
          );
          if (mixTracksJson) {
            try {
              const mixTracks: unknown = JSON.parse(mixTracksJson);
              uris = isStringArray(mixTracks) ? mixTracks : null;
              localStorage.setItem("currentPlayingMixId", mappedId);
            } catch (e) {
              console.error("Error parsing mix tracks:", e);
            }
          }
        } else if (mappedType === "liked-songs") {
          if (spotifyUserId) {
            contextUri = `spotify:user:${spotifyUserId}:collection`;
          } else {
            const likedTracksJson = getButtonMappingValue(
              buttonNumber,
              "Tracks",
              deviceId,
            );
            if (likedTracksJson) {
              try {
                const likedTracks: unknown = JSON.parse(likedTracksJson);
                uris = isStringArray(likedTracks) ? likedTracks : null;
              } catch (e) {
                console.error("Error parsing liked tracks:", e);
              }
            }
          }
          localStorage.setItem("playingLikedSongs", "true");
        }

        let success = false;
        const DJ_PLAYLIST_ID = "37i9dQZF1EYkqdzj48dyYq";

        if (mappedType === "playlist" && mappedId === DJ_PLAYLIST_ID) {
          success = await (playDJMix
            ? playDJMix(currentPlayback?.device?.id)
            : playTrack(null, contextUri));
        } else if (contextUri) {
          success = await playTrack(null, contextUri);
        } else if (uris && uris.length > 0) {
          success = await playTrack(null, null, uris);
        }

        if (success) {
          setTimeout(() => {
            refreshPlaybackState();
            setActiveSection("nowPlaying");
          }, 500);
        }

        setTimeout(() => {
          setShowMappingOverlay(false);
          setActiveButton(null);
          setIsProcessingButtonPress(false);
        }, 1500);
      } catch (error) {
        console.error("Error playing mapped content:", error);
        setShowMappingOverlay(false);
        setActiveButton(null);
        setIsProcessingButtonPress(false);
      }
    },
    [
      playTrack,
      playDJMix,
      refreshPlaybackState,
      setActiveSection,
      isProcessingButtonPress,
      isTutorialActive,
      isDisabled,
      currentPlayback,
      spotifyUserId,
    ],
  );

  useEffect(() => {
    if (isTutorialActive) return;

    if (isDisabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const validButtons = ["1", "2", "3", "4"];
      const buttonNumber = e.key;

      if (!validButtons.includes(buttonNumber)) return;
      e.preventDefault();
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const validButtons = ["1", "2", "3", "4"];
      const buttonNumber = e.key;

      if (!validButtons.includes(buttonNumber)) return;

      if (ignoreNextReleaseRef.current) {
        ignoreNextReleaseRef.current = false;
        return;
      }

      handleButtonPress(buttonNumber);
      e.preventDefault();
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });

    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
    };
  }, [handleButtonPress, isTutorialActive, isDisabled]);

  const setIgnoreNextRelease = useCallback(() => {
    ignoreNextReleaseRef.current = true;
  }, []);

  return {
    showMappingOverlay: isDisabled ? false : showMappingOverlay,
    activeButton,
    setIgnoreNextRelease,
  };
}

function AppContent() {
  const {
    settings,
    updateSetting,
    isNativePhonePresentationLocked,
    nativePhonePresentationLockMessage,
    showNativePhoneCalls,
  } = useSettings();
  const isMockingbirdEnabled = settings.mockingbirdUiEnabled === true;
  const { isSubscribed, hasPhoneAccess } = useSubscription();
  const {
    incomingCall,
    pendingAction: pendingPhoneCallAction,
    error: phoneCallError,
    accept: acceptPhoneCall,
    decline: declinePhoneCall,
  } = usePhoneCalls();
  const presentedIncomingCall = selectPresentedPhoneCall(
    incomingCall,
    showNativePhoneCalls,
  );
  const [appPlatform, setAppPlatform] = useState<string | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [currentTutorialStep, setCurrentTutorialStep] = useState(0);
  const [activeSection, setActiveSection] = useState<ActiveSection>("recents");
  const previousSectionRef = useRef<ActiveSection>("recents");
  const activeSectionRef = useRef(activeSection);
  const idleLockActiveRef = useRef(false);

  useEffect(() => {
    activeSectionRef.current = activeSection;
    if (activeSection !== "lock") {
      previousSectionRef.current = activeSection;
    }
  }, [activeSection]);
  const [viewingContent, setViewingContent] = useState<ViewingContent | null>(
    null,
  );
  const [contentSourceSection, setContentSourceSection] =
    useState<ActiveSection | null>(null);
  const [isDeviceSwitcherOpen, setIsDeviceSwitcherOpen] = useState(false);
  const [playbackIntentOnDeviceSwitch, setPlaybackIntentOnDeviceSwitch] =
    useState<DeviceSwitcherIntent | null>(null);
  const [prefetchedDevices, setPrefetchedDevices] = useState<
    BluetoothDevice[] | null
  >(null);
  const [displaySleepOverlayVisible, setDisplaySleepOverlayVisible] =
    useState(false);
  const [powerMenuVisible, setPowerMenuVisible] = useState(false);
  const [hasOpenedPowerMenu, setHasOpenedPowerMenu] = useState(false);
  const [hasShownMappingOverlay, setHasShownMappingOverlay] = useState(false);
  const powerMenuVisibleRef = useRef(false);
  const displaySleepingRef = useRef(false);
  const displaySleepRequestedRef = useRef(false);
  const displaySleepDesiredRef = useRef(false);
  const displaySleepOperationRef = useRef(0);
  const displaySleepRequestPromiseRef = useRef<Promise<unknown> | null>(null);
  const displayWakeRequestPromiseRef = useRef<Promise<unknown> | null>(null);
  const wakeInputBlockUntilRef = useRef(0);
  const ignoreWakeLockButtonReleaseRef = useRef(false);
  const [displayWakeSequence, setDisplayWakeSequence] = useState(0);
  const [showNetworkBanner, setShowNetworkBanner] = useState(false);
  const [showExhaustedReconnectScreen, setShowExhaustedReconnectScreen] =
    useState(false);
  const [showAuthScreen, setShowAuthScreen] = useState(false);
  const [isSpotifyAuthenticated, setIsSpotifyAuthenticated] = useState<
    boolean | null
  >(null);
  const [isSpotifySkipped, setIsSpotifySkipped] = useState(false);
  const [needsSpotifyAuthorization, setNeedsSpotifyAuthorization] =
    useState(false);
  const [authStatusMessage, setAuthStatusMessage] = useState<string | null>(
    null,
  );
  const [hasSeenTutorialFlag, setHasSeenTutorialFlag] = useState(
    () => localStorage.getItem("hasSeenTutorial") === "true",
  );
  const [
    hasSeenMockingbirdOnboardingFlag,
    setHasSeenMockingbirdOnboardingFlag,
  ] = useState(
    () => localStorage.getItem("hasSeenMockingbirdOnboarding") === "true",
  );
  const [isAuthCheckInProgress, setIsAuthCheckInProgress] = useState(false);
  const [appReady, setAppReady] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const startSectionAppliedRef = useRef(false);
  const lastSpotifyAuthStateRef = useRef<boolean | null>(null);
  const lastSpotifySkippedStateRef = useRef(false);
  const splashFlowWithDeviceRef = useRef(false);

  useEffect(() => {
    powerMenuVisibleRef.current = powerMenuVisible;
  }, [powerMenuVisible]);

  useEffect(() => {
    if (powerMenuVisible) {
      setHasOpenedPowerMenu(true);
    }
  }, [powerMenuVisible]);

  const {
    currentPlayback,
    currentlyPlayingAlbum,
    albumChangeEvent,
    playerIsLoading,
    playerError,
    refreshPlaybackState,
    isReceivingNowPlayingUpdates,
    playerEventSequence,
    playerControls,
    recentAlbums,
    userPlaylists,
    topArtists,
    likedSongs,
    radioMixes,
    userShows,
    spotifyUserId,
    initialDataLoaded,
    isLoading,
    errors: dataErrors,
    refreshData,
    refreshRecentlyPlayed,
  } = useSpotifyData(activeSection, false, true, isMockingbirdEnabled);

  const { isLoading: isInfoLoading, refetch: refetchInfo } = useNocturneInfo();

  useEffect(() => {
    const syncFromStorage = () => {
      setHasSeenTutorialFlag(
        localStorage.getItem("hasSeenTutorial") === "true",
      );
      setHasSeenMockingbirdOnboardingFlag(
        localStorage.getItem("hasSeenMockingbirdOnboarding") === "true",
      );
    };

    syncFromStorage();

    window.addEventListener("storage", syncFromStorage);

    return () => {
      window.removeEventListener("storage", syncFromStorage);
    };
  }, []);

  useEffect(() => {
    const handleShowBanner = () => setShowNetworkBanner(true);
    const handleHideBanner = () => setShowNetworkBanner(false);
    const handleShowNetworkScreen = () => setShowExhaustedReconnectScreen(true);
    const handleHideNetworkScreen = () =>
      setShowExhaustedReconnectScreen(false);

    window.addEventListener("networkBannerShow", handleShowBanner);
    window.addEventListener("networkBannerHide", handleHideBanner);
    window.addEventListener("networkScreenShow", handleShowNetworkScreen);
    window.addEventListener("networkScreenHide", handleHideNetworkScreen);

    return () => {
      window.removeEventListener("networkBannerShow", handleShowBanner);
      window.removeEventListener("networkBannerHide", handleHideBanner);
      window.removeEventListener("networkScreenShow", handleShowNetworkScreen);
      window.removeEventListener("networkScreenHide", handleHideNetworkScreen);
    };
  }, []);

  const {
    devices,
    pairingRequest,
    isConnecting,
    showTetheringScreen,
    lastConnectedDevice,
    connectedDevices,
    activeSessionDevices,
    isReconnectPending,
    hasFetchedInitialDevices,
    acceptPairing,
    denyPairing,
    disconnectDevice,
    enableNetworking,
    stopRetrying,
    // Boundary cast while the daemon hook exports its typed Bluetooth facade.
  } = useBluetooth() as unknown as BluetoothHookState;

  const { addMessageListener, removeMessageListener, wsConnected } =
    useNocturned();

  const hasDevices =
    (Array.isArray(devices) && devices.length > 0) ||
    (Array.isArray(connectedDevices) && connectedDevices.length > 0) ||
    Boolean(lastConnectedDevice);
  const hasStoredBluetoothDevice = Boolean(
    localStorage.getItem("lastConnectedBluetoothDevice"),
  );
  const hasKnownBluetoothDevice = hasDevices || hasStoredBluetoothDevice;

  const processSpotifyAuthMessage = useCallback(
    (message: WsMessage | UnknownRecord | null | undefined) => {
      const messageRecord = toRecord(message);
      if (!messageRecord) return false;

      let topic =
        typeof messageRecord.topic === "string" ? messageRecord.topic : null;
      const resultRecord = toRecord(messageRecord.result);
      let data: unknown =
        messageRecord.data ??
        messageRecord.payload ??
        toRecord(resultRecord?.data) ??
        toRecord(resultRecord?.payload) ??
        resultRecord ??
        null;

      if (!topic && typeof resultRecord?.topic === "string") {
        topic = resultRecord.topic;
      }

      if (!topic && messageRecord.type === "event") {
        topic =
          typeof messageRecord.topic === "string" ? messageRecord.topic : null;
      }

      if (
        !topic &&
        (messageRecord.authenticated !== undefined ||
          resultRecord?.authenticated !== undefined)
      ) {
        topic = "spotify.auth.status";
        data =
          resultRecord?.authenticated !== undefined
            ? resultRecord
            : messageRecord;
      }

      const dataRecord = toRecord(data);
      if (!topic || !dataRecord) {
        return false;
      }

      const nestedData = toRecord(dataRecord.data);
      const authData =
        dataRecord.authenticated === undefined && nestedData
          ? nestedData
          : dataRecord;

      const authenticatedValue = authData.authenticated;
      const needsAuthorizationValue = authData.needsAuthorization;
      const skippedValue = authData.skipped;

      if (authData.loading === true && authenticatedValue === false) {
        return true;
      }

      const isAuthenticated =
        authenticatedValue === true ||
        authenticatedValue === 1 ||
        authenticatedValue === "1";

      const isSkipped = skippedValue === true;

      const needsAuthorization =
        isAuthenticated || isSkipped
          ? false
          : needsAuthorizationValue === undefined
            ? true
            : needsAuthorizationValue === true ||
              needsAuthorizationValue === 1 ||
              needsAuthorizationValue === "1";

      setIsSpotifyAuthenticated(isAuthenticated);
      if (skippedValue !== undefined) {
        setIsSpotifySkipped(isSkipped);
      }
      setNeedsSpotifyAuthorization(needsAuthorization);
      setAuthStatusMessage(
        hasDevices &&
          needsAuthorization &&
          isAuthenticated === false &&
          !isSkipped
          ? "Open the Nocturne app to finish logging into Spotify."
          : null,
      );

      if (isAuthenticated) {
        refreshPlaybackState(true);

        const wasSkipped = lastSpotifySkippedStateRef.current === true;
        const wasNotAuthenticated = lastSpotifyAuthStateRef.current === false;
        const shouldForceDataLoad =
          wasSkipped || (wasNotAuthenticated && initialDataLoaded);

        if (shouldForceDataLoad) {
          setTimeout(() => {
            refreshData();
          }, 1000);
        }
      }

      lastSpotifyAuthStateRef.current = isAuthenticated;
      lastSpotifySkippedStateRef.current = isSkipped;

      setIsAuthCheckInProgress(false);
      return true;
    },
    [refreshPlaybackState, initialDataLoaded, refreshData, hasDevices],
  );

  useEffect(() => {
    const unsubscribe = subscribeAppReadyState(
      (state: { ready: boolean; platform: string | null }) => {
        setAppReady(state.ready);
        setAppPlatform(state.platform);
      },
    );

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeSpotifySkippedState((skipped: boolean) => {
      setIsSpotifySkipped(skipped);
      lastSpotifySkippedStateRef.current = skipped;
    });

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    if (!wsConnected) return;

    if (!appReady) return;

    if (hasPhoneAccess === false && appPlatform !== "web") return;

    let cancelled = false;
    let retryCount = 0;
    const maxRetries = 5;

    setIsAuthCheckInProgress(true);

    const attemptRequest = () => {
      sendNocturneWsRequest<UiLooseData>(
        "spotify.auth.getStatus",
        {},
        { timeoutMs: 5000 },
      )
        .then((authResult) => {
          if (cancelled) return;

          const resultData = toRecord(authResult?.result) ?? authResult;
          const nestedResultData = toRecord(resultData.data);
          const isLoading =
            resultData.loading === true || nestedResultData?.loading === true;
          if (isLoading && retryCount < maxRetries) {
            retryCount++;
            setTimeout(attemptRequest, 2000);
            return;
          }

          processSpotifyAuthMessage(authResult);
        })
        .catch((err) => {
          if (cancelled) return;
          console.error(
            `Failed to fetch spotify auth status (attempt ${retryCount + 1}/${maxRetries}):`,
            err,
          );

          if (retryCount < maxRetries) {
            retryCount++;
            setTimeout(attemptRequest, 1000);
          } else {
            console.error("Max retry attempts reached for spotify auth status");
            setIsAuthCheckInProgress(false);
          }
        });
    };

    attemptRequest();

    return () => {
      cancelled = true;
    };
  }, [wsConnected, appReady, hasPhoneAccess, appPlatform]);

  useEffect(() => {
    if (!showAuthScreen || !appReady || !wsConnected) return;
    if (hasPhoneAccess === false && appPlatform !== "web") return;

    const interval = setInterval(() => {
      sendNocturneWsRequest("spotify.auth.getStatus", {}, { timeoutMs: 5000 })
        .then((authResult) => {
          processSpotifyAuthMessage(authResult);
        })
        .catch((err) => {
          console.warn("Failed to refresh Spotify auth status:", err);
        });
    }, 5000);

    return () => clearInterval(interval);
  }, [
    showAuthScreen,
    appReady,
    wsConnected,
    processSpotifyAuthMessage,
    hasPhoneAccess,
    appPlatform,
  ]);

  useEffect(() => {
    if (hasPhoneAccess === false && appPlatform !== "web") {
      setShowAuthScreen(false);
      setShowTutorial(false);
      return;
    }

    if (isSpotifySkipped) {
      setShowAuthScreen(false);
      if (!hasSeenTutorialFlag && appReady) {
        setShowTutorial(true);
      } else {
        setShowTutorial(false);
      }
      if (splashFlowWithDeviceRef.current) {
        splashFlowWithDeviceRef.current = false;
      }
      return;
    }

    if (needsSpotifyAuthorization || isSpotifyAuthenticated === false) {
      setShowAuthScreen(true);
      setShowTutorial(false);

      if (splashFlowWithDeviceRef.current) {
        splashFlowWithDeviceRef.current = false;
      }
      return;
    }

    if (!hasSeenTutorialFlag) {
      if (isSpotifyAuthenticated && appReady) {
        setShowAuthScreen(false);
        setShowTutorial(true);
      } else if (!hasDevices || !appReady) {
        setShowAuthScreen(true);
        setShowTutorial(false);
      } else {
        setShowAuthScreen(false);
        setShowTutorial(false);
      }
      if (splashFlowWithDeviceRef.current) {
        splashFlowWithDeviceRef.current = false;
      }
      return;
    }

    if (splashFlowWithDeviceRef.current) {
      return;
    }

    if (!hasDevices && isSpotifyAuthenticated !== true) {
      setShowAuthScreen(false);
      setShowTutorial(false);
      return;
    }

    setShowAuthScreen(false);
    setShowTutorial(false);
  }, [
    hasDevices,
    hasSeenTutorialFlag,
    needsSpotifyAuthorization,
    isSpotifyAuthenticated,
    isSpotifySkipped,
    appReady,
    hasPhoneAccess,
    appPlatform,
  ]);

  useEffect(() => {
    if (!hasSeenTutorialFlag) return;
    if (showTutorial) return;
    if (startSectionAppliedRef.current) return;
    if (isSpotifyAuthenticated !== true) return;

    const shouldStartWithNowPlaying =
      localStorage.getItem("startWithNowPlaying") === "true";
    if (shouldStartWithNowPlaying) {
      setActiveSection("nowPlaying");
    }
    startSectionAppliedRef.current = true;
  }, [
    hasSeenTutorialFlag,
    showTutorial,
    isSpotifyAuthenticated,
    setActiveSection,
  ]);

  useEffect(() => {
    if (!wsConnected) return;

    const lastDeviceAddress = localStorage.getItem(
      "lastConnectedBluetoothDevice",
    );

    if (lastDeviceAddress) {
      splashFlowWithDeviceRef.current = true;
      setShowSplash(false);
      setShowAuthScreen(false);
      setActiveSection("nowPlaying");
    } else {
      setShowSplash(false);
      if (!hasSeenTutorialFlag) {
        setShowAuthScreen(true);
      }
    }
  }, [wsConnected, hasSeenTutorialFlag]);

  const { isUpdating } = useSystemUpdate();

  useEffect(() => {
    const listenerId = addMessageListener(
      "spotify-auth",
      (message: WsMessage) => {
        if (
          message?.type === "event" &&
          typeof message.topic === "string" &&
          message.topic.startsWith("spotify.auth.")
        ) {
          processSpotifyAuthMessage(message);
        }
      },
    );

    return () => {
      if (listenerId) {
        removeMessageListener(listenerId);
      }
    };
  }, [addMessageListener, removeMessageListener, processSpotifyAuthMessage]);

  const [gradientState, updateGradientColors] = useGradientState(activeSection);

  const playbackProgress = usePlaybackProgress(
    currentPlayback,
    refreshPlaybackState,
  );
  const playerIsActive = currentPlayback?.is_playing === true;
  const playerIsActiveRef = useRef(playerIsActive);
  playerIsActiveRef.current = playerIsActive;

  const {
    showMappingOverlay: showGlobalMappingOverlay,
    activeButton: globalActiveButton,
    setIgnoreNextRelease,
  } = useGlobalButtonMapping({
    playTrack: playerControls.playTrack,
    playDJMix: playerControls.playDJMix,
    refreshPlaybackState,
    setActiveSection,
    isTutorialActive: showTutorial,
    isDisabled:
      powerMenuVisible ||
      isUpdating ||
      isMockingbirdEnabled ||
      presentedIncomingCall !== null,
    currentPlayback,
    spotifyUserId,
  });

  useEffect(() => {
    if (showGlobalMappingOverlay) {
      setHasShownMappingOverlay(true);
    }
  }, [showGlobalMappingOverlay]);

  const handleOpenDeviceSwitcher = useCallback(
    (
      playbackIntentOrDevices:
        | DeviceSwitcherIntent
        | BluetoothDevice[]
        | null = null,
      devicesArg: BluetoothDevice[] | null = null,
    ) => {
      let playbackIntent: DeviceSwitcherIntent | null = null;
      let devicesList: BluetoothDevice[] | null = null;

      if (Array.isArray(playbackIntentOrDevices)) {
        devicesList = playbackIntentOrDevices;
      } else {
        playbackIntent = playbackIntentOrDevices;
        devicesList = devicesArg;
      }

      if (playbackIntent) {
        setPlaybackIntentOnDeviceSwitch(playbackIntent);
      }

      if (devicesList && devicesList.length > 0) {
        setPrefetchedDevices(devicesList);
      }

      setIsDeviceSwitcherOpen(true);
    },
    [],
  );

  const handleCloseDeviceSwitcher = useCallback(
    (selectedDeviceId: string | null = null) => {
      setIsDeviceSwitcherOpen(false);
      setPrefetchedDevices(null);
      if (selectedDeviceId && playbackIntentOnDeviceSwitch) {
        const { trackUriToPlay, contextUriToPlay, urisToPlay } =
          playbackIntentOnDeviceSwitch;
        (async () => {
          let success = false;
          if (contextUriToPlay) {
            success = await playerControls.playTrack(
              trackUriToPlay,
              contextUriToPlay,
              null,
              selectedDeviceId,
            );
          } else if (urisToPlay && urisToPlay.length > 0) {
            success = await playerControls.playTrack(
              null,
              null,
              urisToPlay,
              selectedDeviceId,
            );
          } else if (trackUriToPlay) {
            success = await playerControls.playTrack(
              trackUriToPlay,
              null,
              null,
              selectedDeviceId,
            );
          }

          if (success) {
            setTimeout(() => {
              refreshPlaybackState();
              setActiveSection("nowPlaying");
            }, 1500);
          }
          setPlaybackIntentOnDeviceSwitch(null);
        })();
      } else {
        setPlaybackIntentOnDeviceSwitch(null);
      }
    },
    [playbackIntentOnDeviceSwitch, playerControls, refreshPlaybackState],
  );

  const deviceSwitcherContextValue = useMemo(
    () => ({ openDeviceSwitcher: handleOpenDeviceSwitcher }),
    [handleOpenDeviceSwitcher],
  );

  useEffect(() => {
    const handleNetworkRestored = () => {
      refreshPlaybackState(true);
      if (!initialDataLoaded) {
        refreshData();
        refreshRecentlyPlayed();
      }
    };
    window.addEventListener("online", handleNetworkRestored);
    return () => {
      window.removeEventListener("online", handleNetworkRestored);
    };
  }, [
    refreshPlaybackState,
    refreshData,
    refreshRecentlyPlayed,
    initialDataLoaded,
  ]);

  useEffect(() => {
    if (viewingContent) return;

    if (showTutorial || showAuthScreen) {
      updateGradientColors(null, "auth");
      return;
    }

    switch (activeSection) {
      case "recents": {
        const firstAlbumImage =
          recentAlbums[0]?.images?.[1]?.url ||
          recentAlbums[0]?.images?.[0]?.url;
        if (firstAlbumImage) {
          updateGradientColors(firstAlbumImage, "recents");
        }
        break;
      }
      case "library": {
        const firstPlaylistImage =
          userPlaylists[0]?.images?.[1]?.url ||
          userPlaylists[0]?.images?.[0]?.url;
        updateGradientColors(firstPlaylistImage || null, "library");
        break;
      }
      case "artists": {
        const firstArtistImage =
          topArtists[0]?.images?.[1]?.url || topArtists[0]?.images?.[0]?.url;
        if (firstArtistImage) {
          updateGradientColors(firstArtistImage, "artists");
        }
        break;
      }
      case "radio": {
        const firstMixImage = radioMixes[0]?.images?.[0]?.url || null;
        updateGradientColors(firstMixImage, "radio");
        break;
      }
      case "podcasts": {
        const firstShow = userShows[0];
        const firstShowImage =
          firstShow?.images?.[1]?.url || firstShow?.images?.[0]?.url;
        updateGradientColors(firstShowImage || null, "podcasts");
        break;
      }
      case "settings":
        updateGradientColors(null, "settings");
        break;
      case "nowPlaying": {
        const albumImage =
          currentlyPlayingAlbum?.images?.[1]?.url ||
          currentlyPlayingAlbum?.images?.[0]?.url;
        if (albumImage) {
          updateGradientColors(albumImage, "nowPlaying");
        }
        break;
      }
      case "lock": {
        const albumImage =
          currentlyPlayingAlbum?.images?.[1]?.url ||
          currentlyPlayingAlbum?.images?.[0]?.url;
        if (albumImage) {
          updateGradientColors(albumImage, "lock");
        }
        break;
      }
      default:
        break;
    }
  }, [
    activeSection,
    viewingContent,
    updateGradientColors,
    recentAlbums,
    userPlaylists,
    topArtists,
    radioMixes,
    userShows,
    currentlyPlayingAlbum,
    showTutorial,
    showAuthScreen,
  ]);

  useEffect(() => {
    if (showTetheringScreen) {
      enableNetworking();
    }
  }, [showTetheringScreen, enableNetworking]);

  const markDisplayAwake = useCallback(() => {
    displaySleepingRef.current = false;
    displaySleepRequestedRef.current = false;
    displaySleepDesiredRef.current = false;
    setDisplaySleepOverlayVisible(false);
  }, []);

  const markDisplaySleeping = useCallback(() => {
    displaySleepingRef.current = true;
    displaySleepRequestedRef.current = true;
    displaySleepDesiredRef.current = true;
    setDisplaySleepOverlayVisible(true);
  }, []);

  const wakeDisplay = useCallback(() => {
    const wasSleeping =
      displaySleepingRef.current || displaySleepRequestedRef.current;
    const shouldSendWake =
      displaySleepRequestedRef.current || displaySleepRequestPromiseRef.current;

    displaySleepDesiredRef.current = false;

    if (wasSleeping) {
      wakeInputBlockUntilRef.current =
        Date.now() + DISPLAY_WAKE_INPUT_SUPPRESS_MS;
    }

    if (!shouldSendWake) return;
    if (displayWakeRequestPromiseRef.current) {
      return displayWakeRequestPromiseRef.current;
    }

    const wakeGeneration = ++displaySleepOperationRef.current;

    const sendWakeRequest = () => {
      if (
        displaySleepDesiredRef.current ||
        displaySleepOperationRef.current !== wakeGeneration
      ) {
        return null;
      }

      return sendNocturneWsRequest(
        "device.display.wake",
        {},
        { timeoutMs: DISPLAY_SLEEP_REQUEST_TIMEOUT_MS },
      )
        .then((result) => {
          if (
            !displaySleepDesiredRef.current &&
            displaySleepOperationRef.current === wakeGeneration
          ) {
            markDisplayAwake();
            setDisplayWakeSequence((sequence) => sequence + 1);
          }
          return result;
        })
        .catch((err) => {
          if (
            !displaySleepDesiredRef.current &&
            displaySleepOperationRef.current === wakeGeneration
          ) {
            displaySleepingRef.current = true;
            displaySleepRequestedRef.current = true;
            setDisplaySleepOverlayVisible(true);
          }
          console.error("Failed to wake display:", err);
          return null;
        });
    };

    const pendingSleepRequest = displaySleepRequestPromiseRef.current;
    const wakeRequest = (
      pendingSleepRequest
        ? pendingSleepRequest.catch(() => null).then(sendWakeRequest)
        : sendWakeRequest()
    )?.finally(() => {
      if (displayWakeRequestPromiseRef.current === wakeRequest) {
        displayWakeRequestPromiseRef.current = null;
      }
    });

    displayWakeRequestPromiseRef.current = wakeRequest ?? null;
    return wakeRequest;
  }, [markDisplayAwake]);

  useEffect(() => {
    if (!presentedIncomingCall) return;
    void wakeDisplay();
    setIsDeviceSwitcherOpen(false);
    setPowerMenuVisible(false);
  }, [
    presentedIncomingCall?.callId,
    presentedIncomingCall?.device,
    wakeDisplay,
  ]);

  useEffect(() => {
    if (!presentedIncomingCall) return;

    const suppressHardwareInput = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const mockingbirdHardwareEvents = window.carThingRootStore?.hardwareEvents;

    mockingbirdHardwareEvents?.stopListening?.();
    window.addEventListener("keydown", suppressHardwareInput, true);
    window.addEventListener("keyup", suppressHardwareInput, true);
    window.addEventListener("wheel", suppressHardwareInput, {
      capture: true,
      passive: false,
    });

    return () => {
      window.removeEventListener("keydown", suppressHardwareInput, true);
      window.removeEventListener("keyup", suppressHardwareInput, true);
      window.removeEventListener("wheel", suppressHardwareInput, true);
      mockingbirdHardwareEvents?.startListening?.();
    };
  }, [presentedIncomingCall]);

  const sleepDisplay = useCallback(() => {
    displaySleepDesiredRef.current = true;

    displaySleepingRef.current = true;
    displaySleepRequestedRef.current = true;
    setDisplaySleepOverlayVisible(true);

    if (displaySleepRequestPromiseRef.current) {
      return displaySleepRequestPromiseRef.current;
    }

    const sleepGeneration = ++displaySleepOperationRef.current;

    const sleepRequest = sendNocturneWsRequest(
      "device.display.sleep",
      {},
      { timeoutMs: DISPLAY_SLEEP_REQUEST_TIMEOUT_MS },
    )
      .catch((err) => {
        if (
          displaySleepDesiredRef.current &&
          displaySleepOperationRef.current === sleepGeneration
        ) {
          displaySleepingRef.current = true;
          displaySleepRequestedRef.current = true;
          setDisplaySleepOverlayVisible(true);
        }
        console.error("Failed to sleep display:", err);
      })
      .finally(() => {
        if (displaySleepRequestPromiseRef.current === sleepRequest) {
          displaySleepRequestPromiseRef.current = null;
        }
      });

    displaySleepRequestPromiseRef.current = sleepRequest;
    return sleepRequest;
  }, []);

  useEffect(() => {
    if (isMockingbirdEnabled) {
      wakeDisplay();
    }
  }, [isMockingbirdEnabled, wakeDisplay]);

  useEffect(() => () => wakeDisplay(), [wakeDisplay]);

  useEffect(() => {
    if (!wsConnected || isMockingbirdEnabled) return;

    let cancelled = false;

    sendNocturneWsRequest(
      "device.display.get",
      {},
      { timeoutMs: DISPLAY_SLEEP_REQUEST_TIMEOUT_MS },
    )
      .then((result) => {
        if (cancelled) return;
        const displayState = result?.result ?? result;
        if (displayState?.sleeping === true) {
          markDisplaySleeping();
        } else if (
          !displaySleepDesiredRef.current &&
          !displayWakeRequestPromiseRef.current
        ) {
          markDisplayAwake();
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("Failed to get display state:", err);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    wsConnected,
    isMockingbirdEnabled,
    markDisplayAwake,
    markDisplaySleeping,
  ]);

  useEffect(() => {
    if (isMockingbirdEnabled) return;

    const stopWakeEvent = (event) => {
      if (event.cancelable) {
        event.preventDefault();
      }
      event.stopPropagation();
      if (event.stopImmediatePropagation) {
        event.stopImmediatePropagation();
      }
    };

    const handleWakeInput = (event) => {
      const isSleeping =
        displaySleepingRef.current || displaySleepRequestedRef.current;

      if (isSleeping) {
        stopWakeEvent(event);
        if (event.type === "keydown" && event.key?.toLowerCase() === "m") {
          ignoreWakeLockButtonReleaseRef.current = true;
        }
        wakeDisplay();
        return;
      }

      if (Date.now() < wakeInputBlockUntilRef.current) {
        stopWakeEvent(event);
      }
    };

    const events = [
      ["touchstart", document, { capture: true, passive: false }],
      ["pointerdown", document, { capture: true }],
      ["mousedown", document, { capture: true }],
      ["click", document, { capture: true }],
      ["wheel", document, { capture: true, passive: false }],
      ["keydown", window, { capture: true }],
      ["keyup", window, { capture: true }],
    ];

    events.forEach(([event, target, options]) => {
      target.addEventListener(event, handleWakeInput, options);
    });

    return () => {
      events.forEach(([event, target, options]) => {
        target.removeEventListener(event, handleWakeInput, options);
      });
    };
  }, [isMockingbirdEnabled, wakeDisplay]);

  useEffect(() => {
    if (showTutorial) return;

    if (viewingContent) return;

    if (currentlyPlayingAlbum?.is_phone_media) return;

    const activeGradientSection = activeSectionRef.current;
    const albumImage =
      currentlyPlayingAlbum?.images?.[1]?.url ||
      currentlyPlayingAlbum?.images?.[0]?.url;

    if (albumImage) {
      if (activeGradientSection === "nowPlaying") {
        updateGradientColors(albumImage, "nowPlaying");
      } else if (activeGradientSection === "recents") {
        updateGradientColors(albumImage, "recents");
      }
    } else if (currentlyPlayingAlbum?.type === "local-track") {
      if (
        activeGradientSection === "recents" ||
        activeGradientSection === "nowPlaying"
      ) {
        updateGradientColors("/images/not-playing.webp", activeGradientSection);
      }
    }
  }, [
    currentlyPlayingAlbum,
    updateGradientColors,
    showTutorial,
    viewingContent,
  ]);

  const handleIdleLock = useCallback(() => {
    if (activeSectionRef.current === "lock") return;

    previousSectionRef.current = activeSectionRef.current || "recents";
    idleLockActiveRef.current = true;

    activeSectionRef.current = "lock";
    setActiveSection("lock");
  }, []);

  const handleCloseLockView = useCallback(() => {
    idleLockActiveRef.current = false;
    const target = previousSectionRef.current || "recents";
    activeSectionRef.current = target;
    setActiveSection(target);
  }, []);

  useEffect(() => {
    if (
      playerEventSequence > 0 &&
      (displaySleepingRef.current || displaySleepRequestedRef.current)
    ) {
      wakeDisplay();
    }
  }, [playerEventSequence, wakeDisplay]);

  useEffect(() => {
    if (!playerIsActive) return;

    if (displaySleepingRef.current || displaySleepRequestedRef.current) {
      wakeDisplay();
    }
  }, [currentPlayback, playerIsActive, wakeDisplay]);

  useEffect(() => {
    if (!currentPlayback?.is_playing) return;

    if (!idleLockActiveRef.current) return;

    const isLocked = activeSectionRef.current === "lock";
    const target = previousSectionRef.current ?? "nowPlaying";

    if (isLocked) {
      setActiveSection(target);
      activeSectionRef.current = target;
    }

    idleLockActiveRef.current = false;
  }, [currentPlayback]);

  useEffect(() => {
    if (
      !settings.idleLockEnabled ||
      isMockingbirdEnabled ||
      showTutorial ||
      presentedIncomingCall
    ) {
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (activeSectionRef.current === "lock") return;
      timeoutId = setTimeout(() => {
        timeoutId = null;
        handleIdleLock();
      }, IDLE_LOCK_MS);
    };

    const markActivity = () => {
      if (activeSectionRef.current === "lock") return;
      schedule();
    };

    const events = [
      ["pointerdown", document, { capture: true, passive: true }],
      ["touchstart", document, { capture: true, passive: true }],
      ["click", document, { capture: true, passive: true }],
      ["wheel", document, { capture: true, passive: true }],
      ["keydown", window, { capture: true }],
    ];

    schedule();

    events.forEach(([event, target, options]) => {
      target.addEventListener(event, markActivity, options);
    });

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      events.forEach(([event, target, options]) => {
        target.removeEventListener(event, markActivity, options);
      });
    };
  }, [
    settings.idleLockEnabled,
    isMockingbirdEnabled,
    showTutorial,
    presentedIncomingCall,
    activeSection,
    handleIdleLock,
  ]);

  useEffect(() => {
    if (
      !settings.idleDisplaySleepEnabled ||
      isMockingbirdEnabled ||
      showTutorial ||
      presentedIncomingCall
    ) {
      if (
        !settings.idleDisplaySleepEnabled ||
        isMockingbirdEnabled ||
        presentedIncomingCall
      ) {
        wakeDisplay();
      }
      return;
    }

    if (playerIsActive) {
      wakeDisplay();
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (displaySleepingRef.current || displaySleepRequestedRef.current) {
        return;
      }
      timeoutId = setTimeout(() => {
        timeoutId = null;
        if (playerIsActiveRef.current) {
          return;
        }
        sleepDisplay();
      }, DISPLAY_IDLE_SLEEP_MS);
    };

    const markActivity = () => {
      if (displaySleepingRef.current || displaySleepRequestedRef.current) {
        return;
      }
      schedule();
    };

    const events = [
      ["pointerdown", document, { capture: true, passive: true }],
      ["touchstart", document, { capture: true, passive: true }],
      ["click", document, { capture: true, passive: true }],
      ["wheel", document, { capture: true, passive: true }],
      ["keydown", window, { capture: true }],
    ];

    schedule();

    events.forEach(([event, target, options]) => {
      target.addEventListener(event, markActivity, options);
    });

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      events.forEach(([event, target, options]) => {
        target.removeEventListener(event, markActivity, options);
      });
    };
  }, [
    settings.idleDisplaySleepEnabled,
    isMockingbirdEnabled,
    showTutorial,
    presentedIncomingCall,
    activeSection,
    displayWakeSequence,
    playerIsActive,
    sleepDisplay,
    wakeDisplay,
  ]);

  useEffect(() => {
    const holdTimerRef: { current: ReturnType<typeof setTimeout> | null } = {
      current: null,
    };
    const longPressTriggeredRef = { current: false };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.key || e.key.toLowerCase() !== "m") return;

      if (presentedIncomingCall) return;

      if (displaySleepingRef.current || displaySleepRequestedRef.current)
        return;

      if (powerMenuVisibleRef.current) return;

      if (longPressTriggeredRef.current) return;

      if (showTutorial && currentTutorialStep === 7) {
        return;
      }

      if (!holdTimerRef.current) {
        holdTimerRef.current = setTimeout(() => {
          longPressTriggeredRef.current = true;
          setPowerMenuVisible(true);
          holdTimerRef.current = null;
        }, 600);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!e.key || e.key.toLowerCase() !== "m") return;

      if (presentedIncomingCall) return;

      if (ignoreWakeLockButtonReleaseRef.current) {
        ignoreWakeLockButtonReleaseRef.current = false;
        if (e.cancelable) {
          e.preventDefault();
        }
        e.stopPropagation();
        return;
      }

      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }

      if (longPressTriggeredRef.current) {
        longPressTriggeredRef.current = false;
        return;
      }

      if (powerMenuVisibleRef.current) {
        setPowerMenuVisible(false);
        e.stopPropagation();
        return;
      }

      if (showAuthScreen) {
        return;
      }

      if (isMockingbirdEnabled) {
        window.carThingRootStore?.uiState?.toggleSettings();
        return;
      }

      if (activeSectionRef.current === "lock") {
        idleLockActiveRef.current = false;
        const target = previousSectionRef.current || "recents";
        setActiveSection(target);
        activeSectionRef.current = target;
      } else {
        idleLockActiveRef.current = false;
        previousSectionRef.current = activeSectionRef.current;
        setActiveSection("lock");
        activeSectionRef.current = "lock";
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });

    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    };
  }, [
    showTutorial,
    currentTutorialStep,
    showAuthScreen,
    isMockingbirdEnabled,
    presentedIncomingCall,
  ]);

  const handleShutdown = () => {
    fetch("http://localhost:5000/device/power/shutdown", {
      method: "POST",
    }).catch((err) => console.error("Shutdown request failed", err));
    setPowerMenuVisible(false);
  };

  const handleReboot = () => {
    fetch("http://localhost:5000/device/power/reboot", {
      method: "POST",
    }).catch((err) => console.error("Restart request failed", err));
    setPowerMenuVisible(false);
  };

  const handleTutorialComplete = () => {
    setShowTutorial(false);
    setCurrentTutorialStep(0);
    if (isMockingbirdEnabled) {
      localStorage.setItem("hasSeenMockingbirdOnboarding", "true");
      setHasSeenMockingbirdOnboardingFlag(true);
    } else {
      localStorage.setItem("hasSeenTutorial", "true");
      setHasSeenTutorialFlag(true);
    }
    startSectionAppliedRef.current = true;
    const shouldStartWithNowPlaying =
      localStorage.getItem("startWithNowPlaying") === "true";
    if (shouldStartWithNowPlaying) {
      setActiveSection("nowPlaying");
    } else {
      setActiveSection("recents");
    }
  };

  const handleOpenContent = (id: string, type: ContentType) => {
    setContentSourceSection(activeSection);
    setViewingContent({ id, type });
    if (type === "artist") {
      setActiveSection("artists");
    } else if (type === "album") {
      setActiveSection("recents");
    }
  };

  const handleNavigateToArtistFromNowPlaying = useCallback(
    (artistId: string, contentType: ContentType) => {
      setContentSourceSection("nowPlaying");
      setViewingContent({ id: artistId, type: contentType });
      setActiveSection("artists");
    },
    [],
  );

  const handleNavigateToAlbumFromNowPlaying = useCallback(
    (albumId: string, contentType: ContentType) => {
      setContentSourceSection("nowPlaying");
      setViewingContent({ id: albumId, type: contentType });
      setActiveSection("recents");
    },
    [],
  );

  const handleCloseContent = () => {
    const source = contentSourceSection;
    setViewingContent(null);
    setContentSourceSection(null);

    if (source) {
      setActiveSection(source);
    }
  };

  const handleNavigateToNowPlaying = () => {
    setViewingContent(null);
    setActiveSection("nowPlaying");
  };

  const handleNavigateToArtist = (id: string, type: ContentType) => {
    setViewingContent({ id, type });
    setActiveSection("artists");
  };

  const handleConnectionRestored = () => {
    refreshPlaybackState(true);
    if (!initialDataLoaded) {
      refreshData();
      refreshRecentlyPlayed();
    }
  };

  const hasActiveBluetoothSession =
    (Array.isArray(activeSessionDevices) &&
      activeSessionDevices.some((device) => device?.connected)) ||
    (appReady && hasStoredBluetoothDevice);

  const { showConnectionLostScreen, showPairingOverlay } =
    getBluetoothPresentationState({
      showTutorial,
      pairingRequest,
      showTetheringScreen,
      hasActiveSession: hasActiveBluetoothSession,
      hasFetchedInitialDevices,
      isReconnectPending,
      showExhaustedReconnectScreen,
    });
  // const showConnectionLostScreen = false;

  const showSubscriptionScreen =
    !showConnectionLostScreen &&
    hasActiveBluetoothSession &&
    appReady &&
    appPlatform !== null &&
    appPlatform !== "web" &&
    hasPhoneAccess === false;

  const isMockingbird = isMockingbirdEnabled;

  const displayNetworkBanner =
    showNetworkBanner &&
    !isMockingbird &&
    !showConnectionLostScreen &&
    !showTutorial &&
    !showAuthScreen &&
    !showSplash;

  const isSystemScreen =
    showSplash || showAuthScreen || showConnectionLostScreen || showTutorial;
  const mockingbirdSystemScreen =
    isMockingbird && !showSplash
      ? showTutorial && !hasSeenMockingbirdOnboardingFlag
        ? "tutorial"
        : showSubscriptionScreen
          ? "subscription"
          : !hasSeenMockingbirdOnboardingFlag &&
              (isSpotifyAuthenticated || isSpotifySkipped) &&
              hasKnownBluetoothDevice
            ? "tutorial"
            : showAuthScreen
              ? "auth"
              : showConnectionLostScreen
                ? "connectionLost"
                : null
      : null;

  const voiceSuppressed =
    isSystemScreen ||
    showSubscriptionScreen ||
    showTetheringScreen ||
    !!pairingRequest ||
    isMockingbird ||
    isSubscribed === false ||
    presentedIncomingCall !== null;

  let content;
  if (showSplash) {
    content = <SplashScreen />;
  } else if (showSubscriptionScreen) {
    content = <LazyAuthScreen subscriptionRequired={true} />;
  } else if (showAuthScreen) {
    content = (
      <LazyAuthScreen
        isLoading={isAuthCheckInProgress}
        statusMessage={authStatusMessage}
        openBluetoothPairing={!hasKnownBluetoothDevice && !appReady}
      />
    );
  } else if (showConnectionLostScreen) {
    content = (
      <LazyNetworkScreen
        isConnectionLost={true}
        deviceName={lastConnectedDevice?.name}
        onConnectionRestored={handleConnectionRestored}
      />
    );
  } else if (showTutorial) {
    content = (
      <LazyTutorial
        onComplete={handleTutorialComplete}
        onStepChange={setCurrentTutorialStep}
      />
    );
  } else if (activeSection === "nowPlaying") {
    content = (
      <LazyNowPlaying
        currentPlayback={currentPlayback}
        playbackProgress={playbackProgress}
        onClose={() => setActiveSection("recents")}
        updateGradientColors={updateGradientColors}
        onOpenDeviceSwitcher={handleOpenDeviceSwitcher}
        onNavigateToArtist={handleNavigateToArtistFromNowPlaying}
        onNavigateToAlbum={handleNavigateToAlbumFromNowPlaying}
        setIgnoreNextRelease={setIgnoreNextRelease}
        isReceivingNowPlayingUpdates={isReceivingNowPlayingUpdates}
      />
    );
  } else if (activeSection === "lock") {
    content = (
      <LazyLockView
        currentPlayback={currentPlayback}
        refreshPlaybackState={refreshPlaybackState}
        updateGradientColors={updateGradientColors}
        onClose={handleCloseLockView}
      />
    );
  } else if (viewingContent) {
    content = (
      <LazyContentView
        contentId={viewingContent.id}
        contentType={viewingContent.type}
        onClose={handleCloseContent}
        onNavigateToNowPlaying={handleNavigateToNowPlaying}
        currentlyPlayingTrackUri={currentPlayback?.item?.uri}
        currentPlayback={currentPlayback}
        radioMixes={radioMixes}
        updateGradientColors={updateGradientColors}
        setIgnoreNextRelease={setIgnoreNextRelease}
        playbackProgress={playbackProgress}
        refreshPlaybackState={refreshPlaybackState}
        spotifyUserId={spotifyUserId}
      />
    );
  } else {
    content = (
      <Home
        activeSection={activeSection}
        setActiveSection={setActiveSection}
        recentAlbums={recentAlbums}
        userPlaylists={userPlaylists}
        topArtists={topArtists}
        likedSongs={likedSongs}
        radioMixes={radioMixes}
        userShows={userShows}
        currentPlayback={currentPlayback}
        currentlyPlayingAlbum={currentlyPlayingAlbum}
        playbackProgress={playbackProgress}
        isLoading={isLoading}
        refreshData={refreshData}
        refreshPlaybackState={refreshPlaybackState}
        onOpenContent={handleOpenContent}
        onOpenDeviceSwitcher={handleOpenDeviceSwitcher}
        onNavigateToNowPlaying={handleNavigateToNowPlaying}
      />
    );
  }

  return (
    <OTAProvider initialDataLoaded={initialDataLoaded}>
      <NotificationProvider>
        <NotificationBridge />
        <VoiceProvider suppressed={voiceSuppressed}>
          <DeviceSwitcherContext.Provider value={deviceSwitcherContextValue}>
            <Router>
              <main className="overflow-hidden relative min-h-screen rounded-2xl nocturne-font-stack">
                <GradientBackground
                  gradientState={gradientState}
                  className="bg-black"
                />

                <div className="relative z-10">
                  <UIShell
                    isMockingbird={isMockingbird}
                    mockingbirdProps={{
                      currentPlayback,
                      playerControls,
                      spotifyData: {
                        recentAlbums,
                        userPlaylists,
                        topArtists,
                        likedSongs,
                        radioMixes,
                        userShows,
                        spotifyUserId,
                        initialDataLoaded,
                      },
                      playbackProgress,
                      systemScreen: mockingbirdSystemScreen,
                      onTutorialComplete: handleTutorialComplete,
                      sharedPhoneDisplaySettings: {
                        phoneCallsEnabled:
                          settings.nativePhoneCallsEnabled !== false,
                        notificationsEnabled:
                          settings.nativeNotificationsEnabled !== false,
                        locked: isNativePhonePresentationLocked,
                        lockedMessage: nativePhonePresentationLockMessage,
                        updateSetting,
                      },
                    }}
                  >
                    <React.Suspense fallback={<ScreenFallback />}>
                      {content}
                    </React.Suspense>
                  </UIShell>
                  {showPairingOverlay && pairingRequest ? (
                    isMockingbird ? (
                      <MockingbirdPairingOverlay
                        pin={pairingRequest.pairingKey ?? ""}
                      />
                    ) : (
                      <React.Suspense fallback={null}>
                        <LazyPairingScreen
                          pin={pairingRequest.pairingKey ?? ""}
                          isConnecting={isConnecting}
                          onAccept={acceptPairing}
                          onReject={denyPairing}
                        />
                      </React.Suspense>
                    )
                  ) : null}
                  {displayNetworkBanner && (
                    <React.Suspense fallback={null}>
                      <LazyNetworkBanner
                        visible={displayNetworkBanner}
                        onClose={() => setShowNetworkBanner(false)}
                      />
                    </React.Suspense>
                  )}
                  {isDeviceSwitcherOpen && (
                    <React.Suspense fallback={null}>
                      <LazyDeviceSwitcherModal
                        isOpen={isDeviceSwitcherOpen}
                        onClose={handleCloseDeviceSwitcher}
                        initialDevices={prefetchedDevices}
                      />
                    </React.Suspense>
                  )}
                  {!showTutorial &&
                    (showGlobalMappingOverlay || hasShownMappingOverlay) && (
                      <React.Suspense fallback={null}>
                        <LazyButtonMappingOverlay
                          show={showGlobalMappingOverlay}
                          activeButton={globalActiveButton}
                        />
                      </React.Suspense>
                    )}
                  {(powerMenuVisible || hasOpenedPowerMenu) && (
                    <React.Suspense fallback={null}>
                      <LazyPowerMenuOverlay
                        show={powerMenuVisible}
                        onShutdown={handleShutdown}
                        onReboot={handleReboot}
                        onClose={() => setPowerMenuVisible(false)}
                      />
                    </React.Suspense>
                  )}
                </div>
              </main>
              <DeferredVoiceOverlay />
              <DeferredNotificationsContainer />
              {presentedIncomingCall && isMockingbird ? (
                <MockingbirdPhoneCallOverlay
                  call={presentedIncomingCall}
                  pendingAction={pendingPhoneCallAction}
                  error={phoneCallError}
                  onAccept={acceptPhoneCall}
                  onDecline={declinePhoneCall}
                />
              ) : presentedIncomingCall ? (
                <React.Suspense fallback={null}>
                  <LazyIncomingCallOverlay
                    call={presentedIncomingCall}
                    pendingAction={pendingPhoneCallAction}
                    error={phoneCallError}
                    onAccept={acceptPhoneCall}
                    onDecline={declinePhoneCall}
                  />
                </React.Suspense>
              ) : null}
              {displaySleepOverlayVisible && (
                <div
                  aria-hidden="true"
                  style={{
                    position: "fixed",
                    top: 0,
                    left: 0,
                    width: "100vw",
                    height: "100vh",
                    background: "#000",
                    zIndex: 2147483647,
                  }}
                />
              )}
            </Router>
          </DeviceSwitcherContext.Provider>
        </VoiceProvider>
      </NotificationProvider>
    </OTAProvider>
  );
}

function App() {
  return (
    <SettingsProvider>
      <AppContent />
    </SettingsProvider>
  );
}

export default App;
