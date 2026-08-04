import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useLayoutEffect,
} from "react";
import {
  CarThingStoreProvider,
  useCarThingStore,
} from "./contexts/CarThingStore";
import { observer } from "mobx-react-lite";
import Main from "./components/Main";
import Settings from "./components/Settings/Settings";
import {
  getAppReadyState,
  sendNocturneWsRequest,
  subscribeAppReadyState,
} from "../../hooks/useNocturned";
import "./styles/MockingbirdShell.scss";

const LazySetup = React.lazy(() => import("./components/Setup/Setup"));
const LazyOnboarding = React.lazy(
  () => import("./components/Onboarding/Onboarding"),
);

function useCurrentAppReadyState() {
  const [state, setState] = useState(() => getAppReadyState());

  useEffect(() => subscribeAppReadyState(setState), []);

  return state;
}

function usePlaybackPolling(parentPlayback, appReady) {
  const [localPlayback, setLocalPlayback] = useState(null);
  const pollingRef = useRef(null);
  const stoppedRef = useRef(false);

  const poll = useCallback(async () => {
    try {
      const data = await sendNocturneWsRequest(
        "spotify.player.state",
        {},
        { timeoutMs: 5000 },
      );
      if (data && data.item && !stoppedRef.current) {
        setLocalPlayback(data);
      }
    } catch (error) {
      console.debug("Mockingbird playback poll failed:", error);
    }
    if (!stoppedRef.current) {
      pollingRef.current = setTimeout(poll, 3000);
    }
  }, []);

  useEffect(() => {
    if (parentPlayback || !appReady) {
      stoppedRef.current = true;
      if (pollingRef.current) {
        clearTimeout(pollingRef.current);
        pollingRef.current = null;
      }
      setLocalPlayback(null);
      return;
    }

    stoppedRef.current = false;
    pollingRef.current = setTimeout(poll, 1500);

    return () => {
      stoppedRef.current = true;
      if (pollingRef.current) {
        clearTimeout(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [appReady, parentPlayback, poll]);

  return parentPlayback || localPlayback;
}

function DataLoadingScreen() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
    >
      <div style={{ display: "flex", gap: "16px" }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              background: "#fff",
              animation: `mockingbird-dot-pulse 1.4s ease-in-out infinite`,
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
      </div>
      <style>{`
        @keyframes mockingbird-dot-pulse {
          0%, 80%, 100% { opacity: 0.15; }
          40% { opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}

function SplashOverlay() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#2d2d2d",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
    >
      <img
        src="/images/appstart.png"
        alt="Nocturne"
        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
      />
    </div>
  );
}

const NightModeApplication = observer(({ children }: UiComponentProps) => {
  const opacity = useCarThingStore().nightModeController.appOpacity;

  useLayoutEffect(() => {
    document.documentElement.style.setProperty(
      "--mockingbird-night-opacity",
      String(opacity),
    );
  }, [opacity]);

  useLayoutEffect(() => {
    document.documentElement.classList.add("mockingbird-night-mode-active");

    return () => {
      document.documentElement.classList.remove(
        "mockingbird-night-mode-active",
      );
      document.documentElement.style.removeProperty(
        "--mockingbird-night-opacity",
      );
    };
  }, []);

  return children;
});

export default function MockingbirdShell({
  currentPlayback: parentPlayback,
  playerControls,
  spotifyData: parentSpotifyData,
  playbackProgress,
  systemScreen,
  onTutorialComplete,
  sharedPhoneDisplaySettings,
}: UiComponentProps) {
  const appReadyState = useCurrentAppReadyState();
  const currentPlayback = usePlaybackPolling(
    parentPlayback,
    appReadyState.ready,
  );
  const spotifyData = parentSpotifyData || { initialDataLoaded: false };
  const dataReady = spotifyData.initialDataLoaded;

  if (systemScreen && systemScreen !== "tutorial") {
    return (
      <NightModeApplication>
        <div className="mockingbird-root">
          <CarThingStoreProvider
            currentPlayback={currentPlayback}
            playerControls={playerControls}
            spotifyData={spotifyData}
            playbackProgress={playbackProgress}
            onSeek={playerControls?.seekToPosition}
            sharedPhoneDisplaySettings={sharedPhoneDisplaySettings}
          >
            <React.Suspense fallback={<SplashOverlay />}>
              <LazySetup systemScreen={systemScreen} />
            </React.Suspense>
            <Settings />
          </CarThingStoreProvider>
        </div>
      </NightModeApplication>
    );
  }

  if (systemScreen === "tutorial") {
    return (
      <NightModeApplication>
        <div className="mockingbird-root">
          {!dataReady ? (
            <DataLoadingScreen />
          ) : (
            <CarThingStoreProvider
              currentPlayback={currentPlayback}
              playerControls={playerControls}
              spotifyData={spotifyData}
              playbackProgress={playbackProgress}
              onSeek={playerControls?.seekToPosition}
              sharedPhoneDisplaySettings={sharedPhoneDisplaySettings}
            >
              <React.Suspense fallback={<SplashOverlay />}>
                <LazyOnboarding
                  onComplete={onTutorialComplete}
                  dataReady={dataReady}
                />
              </React.Suspense>
            </CarThingStoreProvider>
          )}
        </div>
      </NightModeApplication>
    );
  }

  return (
    <NightModeApplication>
      <div className="mockingbird-root">
        {!dataReady ? (
          <SplashOverlay />
        ) : (
          <CarThingStoreProvider
            currentPlayback={currentPlayback}
            playerControls={playerControls}
            spotifyData={spotifyData}
            playbackProgress={playbackProgress}
            onSeek={playerControls?.seekToPosition}
            sharedPhoneDisplaySettings={sharedPhoneDisplaySettings}
          >
            <Main />
          </CarThingStoreProvider>
        )}
      </div>
    </NightModeApplication>
  );
}
