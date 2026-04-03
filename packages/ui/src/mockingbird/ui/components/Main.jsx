import Views from "./Views/Views";
import Presets from "./Views/Presets/Presets";
import Settings from "./Settings/Settings";
import { useCarThingStore } from "../contexts/CarThingStore";
import { useEffect } from "react";
import { observer } from "mobx-react-lite";
import styles from "../styles/Main.module.scss";

const Main = () => {
  const {
    npvStore,
    shelfStore,
    overlayController,
    viewStore,
    presetsController,
    nightModeController,
    playbackProgress,
    onSeek,
  } = useCarThingStore();

  useEffect(() => {
    setTimeout(() => overlayController.maybeShowAModal(), 2000);
  }, [overlayController]);

  const handlePointerDown = () => {
    if (viewStore.isNpv && !overlayController.anyOverlayIsShowing) {
      npvStore.tipsUiState?.dismissVisibleTip?.();
    }
  };

  const handleClick = () => {
    shelfStore.shelfController?.voiceMuteBannerUiState?.dismissVoiceBanner?.();
  };

  return (
    <div
      className={styles.carThingContainer}
      style={{
        opacity: nightModeController.appOpacity,
        transition: "opacity 1000ms ease",
      }}
    >
      <div
        className={styles.carThingDevice}
        onPointerDown={handlePointerDown}
        onClick={handleClick}
      >
        <Views playbackProgress={playbackProgress} onSeek={onSeek} />
        {presetsController?.presetsUiState?.isShowingPresets && (
          <div
            className={`${styles.presetsOverlay} ${
              presetsController.presetsUiState.isAnimatingOut
                ? styles.presetsExiting
                : styles.presetsEntering
            }`}
          >
            <Presets />
          </div>
        )}
        <Settings />
      </div>
    </div>
  );
};

export default observer(Main);
