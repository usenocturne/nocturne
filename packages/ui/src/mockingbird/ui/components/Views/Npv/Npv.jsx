import classnames from 'classnames';
import { observer } from 'mobx-react-lite';
import { useCarThingStore } from '../../../contexts/CarThingStore';
import DelayedRender from '../../DelayedRender';
import CSSTransition from '../../CSSTransitionCompat';
import { useCallback, useRef, useEffect } from 'react';
import AmbientBackdrop from '../AmbientBackdrop/AmbientBackdrop';
import PlayingInfoOrTip from './PlayingInfoOrTip/PlayingInfoOrTip';
import Controls from './Controls/Controls';
import SwipeHandler from './SwipeHandler/SwipeHandler';
import WindAlertBanner from './WindAlertBanner/WindAlertBanner';
import Scrubbing from './Scrubbing/Scrubbing';
import ScrubbingBackdrop from './Scrubbing/ScrubbingBackdrop';
import NoNetworkBanner from './NoNetworkBanner/NoNetworkBanner';
import OtherMedia from './OtherMedia/OtherMedia';
import Volume from './Volume/Volume';
import styles from './Npv.module.scss';

const getBackgroundColorFromChannels = (rgbChannels) => {
  return `rgb(${rgbChannels.join(',')})`;
};

const Npv = ({ playbackProgress, onSeek }) => {
  const carThingStores = useCarThingStore();
  const {
    npvStore,
    overlayController,
    playerStore,
    hardwareStore,
    ubiLogger,
    voiceStore,
    bannerStore,
    queueStore,
  } = carThingStores;

  const { npvController } = npvStore;

  const showWindAlert = bannerStore.shouldShowWindAlertBanner;
  const showNoNetwork = bannerStore.shouldShowNoNetworkBanner;
  const showOtherMedia = playerStore.isOtherMediaPlaying;

  const handleClick = () => {
    npvStore.tipsUiState?.dismissVisibleTip?.();
  };

  const handleSwipeLeft = () => {
    if (!overlayController.anyOverlayIsShowing) {
      
      npvStore.playingInfoUiState.swipeHandler.handleSwipedLeft();
      ubiLogger.npvInteractionLogger?.logSwipeToNext?.();
    }
  };

  const handleSwipeRight = () => {
    if (!overlayController.anyOverlayIsShowing) {
      
      npvStore.playingInfoUiState.swipeHandler.handleSwipedRight();
      ubiLogger.npvInteractionLogger?.logSwipeToPrevious?.();
    }
  };

  const handleSwipeUp = () => {
    if (!overlayController.anyOverlayIsShowing) {
      npvController.goToContentShelf();
      ubiLogger.npvInteractionLogger.logSwipeToShelf();
    }
  };

  const handleSwipeDown = () => {
    if (!overlayController.anyOverlayIsShowing) {
      npvController.goToQueue();
      ubiLogger.npvInteractionLogger.logSwipeToQueue();
    }
  };

  const showPlayingInfo = !showWindAlert && !showNoNetwork && !showOtherMedia;

  const lastWheelEventRef = useRef(0);
  const wheelDeltaAccumulatorRef = useRef(0);
  const npvContainerRef = useRef(null);

  const handleWheel = useCallback(
    (e) => {
      if (!showPlayingInfo || overlayController.anyOverlayIsShowing) return;
      if (npvStore.scrubbingUiState.isScrubbing) return;

      const now = Date.now();
      if (now - lastWheelEventRef.current < 50) {
        e.preventDefault();
        return;
      }
      lastWheelEventRef.current = now;
      e.preventDefault();
      e.stopPropagation();

      const delta = e.deltaX;
      wheelDeltaAccumulatorRef.current += delta;

      if (Math.abs(wheelDeltaAccumulatorRef.current) >= 2) {
        const direction = wheelDeltaAccumulatorRef.current > 0 ? 1 : -1;
        wheelDeltaAccumulatorRef.current = 0;

        if (carThingStores.volumeStore) {
          if (direction > 0) {
            carThingStores.volumeStore.increaseVolume();
          } else {
            carThingStores.volumeStore.decreaseVolume();
          }
        }
      }
    },
    [showPlayingInfo, overlayController.anyOverlayIsShowing, carThingStores, npvStore.scrubbingUiState.isScrubbing]
  );

  useEffect(() => {
    const container = npvContainerRef.current;
    if (container) {
      const options = { passive: false, capture: true };
      container.addEventListener("wheel", handleWheel, options);
      return () => {
        container.removeEventListener("wheel", handleWheel, options);
      };
    }
  }, [handleWheel]);

  return (
    <>
      {!showOtherMedia && (
        <AmbientBackdrop
          imageId={queueStore.current?.image_uri}
          getBackgroundStyleAttribute={getBackgroundColorFromChannels}
        />
      )}
      <div className={styles.npv} onClick={handleClick} ref={npvContainerRef}>
        <SwipeHandler
          onSwipeLeft={handleSwipeLeft}
          onSwipeRight={handleSwipeRight}
          onSwipeUp={handleSwipeUp}
          onSwipeDown={handleSwipeDown}
          disabled={overlayController.anyOverlayIsShowing}
        >
          <div className={styles.content}>
            <DelayedRender showing={showWindAlert} hideDelay={300}>
              <WindAlertBanner />
            </DelayedRender>

            <DelayedRender showing={showNoNetwork} hideDelay={300}>
              <NoNetworkBanner />
            </DelayedRender>

            <DelayedRender showing={showOtherMedia} hideDelay={300}>
              <OtherMedia />
            </DelayedRender>

            <DelayedRender showing={showPlayingInfo} hideDelay={300}>
              <PlayingInfoOrTip />
            </DelayedRender>
          </div>

          {showPlayingInfo && <Scrubbing playbackProgress={playbackProgress} onSeek={onSeek} />}

          <div className={styles.controlsContainer}>
            <CSSTransition
              in={showPlayingInfo && !npvStore.volumeUiState.shouldShowVolume}
              timeout={500}
              classNames={{
                enter: styles.enter,
                enterActive: styles.enterActive,
                exit: styles.exit,
                exitActive: styles.exitActive,
              }}
              unmountOnExit
            >
              <Controls />
            </CSSTransition>
            <CSSTransition
              in={showPlayingInfo && npvStore.volumeUiState.shouldShowVolume}
              timeout={500}
              classNames={{
                enter: styles.enter,
                enterActive: styles.enterActive,
                exit: styles.exit,
                exitActive: styles.exitActive,
              }}
              unmountOnExit
            >
              <Volume />
            </CSSTransition>
          </div>
        </SwipeHandler>
        <ScrubbingBackdrop playbackProgress={playbackProgress} onSeek={onSeek} />
      </div>
    </>
  );
};

export default observer(Npv);
