import LazyImage from './LazyImage/LazyImage';
import { useCarThingStore } from '../../../../contexts/CarThingStore';
import { observer } from 'mobx-react-lite';
import { cloneElement, useEffect, useRef } from 'react';
import CSSTransition from '../../../CSSTransitionCompat';
import { TransitionGroup } from 'react-transition-group';
import { transitionDurationMs } from '../../../../styles/Variables';
import styles from './Artwork.module.scss';

const SwipeDirection = {
  NONE: 'NONE',
  LEFT: 'LEFT', 
  RIGHT: 'RIGHT',
};

const Artwork = ({ tracks, getAnimationClassNames }) => {
  const { npvStore } = useCarThingStore();
  const uiState = npvStore.playingInfoUiState;
  const lastImageUri = useRef(uiState.currentItem.image_uri);
  const doAnimate =
    uiState.swipeHandler.swipeDirection !== SwipeDirection.NONE &&
    lastImageUri.current !== uiState.currentItem.image_uri;

  useEffect(() => {
    lastImageUri.current = uiState.currentItem.image_uri;
  }, [uiState.currentItem.image_uri]);

  useEffect(() => {
    uiState.loadPrevAndNextImage?.();
  }, [uiState, uiState.previousItem?.image_uri, uiState.nextItem?.image_uri]);

  return (
    <div className={styles.artwork}>
      <TransitionGroup
        className={styles.artworkTransitionGroup}
        enter={doAnimate}
        childFactory={(child) => {
          return cloneElement(child, {
            timeout: transitionDurationMs,
            exit: doAnimate,
            classNames: getAnimationClassNames(),
          });
        }}
      >
        {tracks.map((track) => (
          <CSSTransition
            key={track.uid}
            timeout={transitionDurationMs}
            onEntering={() =>
              uiState.swipeHandler.setSwipeDirection(SwipeDirection.NONE)
            }
          >
            <div className={styles.transitionContainer}>
              <LazyImage
                uri={track.uri}
                size={248}
                imageId={track.image_uri}
                onClick={uiState.handleArtworkClick}
                dataTestId="npv-artwork"
              />
            </div>
          </CSSTransition>
        ))}
      </TransitionGroup>
    </div>
  );
};

export default observer(Artwork);
