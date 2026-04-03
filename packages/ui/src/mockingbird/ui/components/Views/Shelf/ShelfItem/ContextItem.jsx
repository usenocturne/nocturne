import { useEffect, useState, useRef } from 'react';
import { runInAction } from 'mobx';
import classNames from 'classnames';
import { useCarThingStore } from '../../../../contexts/CarThingStore';
import LazyImage from '../../Npv/PlayingInfo/LazyImage/LazyImage';
import { ARTWORK_WIDTH } from './ShelfSwiperItem';
import styles from './ShelfSwiperItem.module.scss';
import shelfSwiperItemStyles from './ShelfSwiperItem.module.scss';

const pointerListenersMaker = (setTouchDown) => ({
  onPointerDown: () => setTouchDown(true),
  onPointerUp: () => setTouchDown(false),
  onPointerLeave: () => setTouchDown(false),
});

const getShelfItemTitle = (title, uri) => {
  
  return title;
};

const useInView = () => {
  
  return { ref: null, inView: true };
};

const EqAnimation = {
  PAUSED: 'PAUSED',
  PAUSE_TO_PLAY: 'PAUSE_TO_PLAY',
  PLAYING: 'PLAYING',
  PLAY_TO_PAUSE: 'PLAY_TO_PAUSE',
};

const PAUSE_PLAY_TRANSITION_MS = 250;

const Equaliser = ({ playing }) => {
  const [eqAnimation, setEqAnimation] = useState(
    playing ? EqAnimation.PLAYING : EqAnimation.PAUSED,
  );

  const playTimeout = useRef();
  const pauseTimeout = useRef();

  useEffect(() => {
    const startPlayingTimer = () => {
      clearTimeout(pauseTimeout.current);
      setEqAnimation(EqAnimation.PAUSE_TO_PLAY);
      playTimeout.current = setTimeout(() => {
        if (playing) {
          setEqAnimation(EqAnimation.PLAYING);
        }
      }, PAUSE_PLAY_TRANSITION_MS);
    };

    const startPausingTimer = () => {
      clearTimeout(playTimeout.current);
      setEqAnimation(EqAnimation.PLAY_TO_PAUSE);
      pauseTimeout.current = setTimeout(
        () => setEqAnimation(EqAnimation.PAUSED),
        PAUSE_PLAY_TRANSITION_MS,
      );
    };

    if (eqAnimation === EqAnimation.PAUSED && playing) {
      startPlayingTimer();
    } else if (eqAnimation === EqAnimation.PLAY_TO_PAUSE && playing) {
      startPlayingTimer();
    } else if (eqAnimation === EqAnimation.PLAYING && !playing) {
      startPausingTimer();
    } else if (eqAnimation === EqAnimation.PAUSE_TO_PLAY && !playing) {
      clearTimeout(playTimeout.current);
      setEqAnimation(EqAnimation.PAUSED);
    }
  }, [eqAnimation, playing]);

  useEffect(
    () => () => {
      clearTimeout(playTimeout.current);
      clearTimeout(pauseTimeout.current);
    },
    [],
  );

  return (
    <div className={styles.bars}>
      <div
        className={classNames(styles.bar, styles.bar1, {
          [styles.pauseToPlay]: eqAnimation === EqAnimation.PAUSE_TO_PLAY,
          [styles.play]: eqAnimation === EqAnimation.PLAYING,
          [styles.playToPause]: eqAnimation === EqAnimation.PLAY_TO_PAUSE,
        })}
      />
      <div
        className={classNames(styles.bar, styles.bar2, {
          [styles.pauseToPlay]: eqAnimation === EqAnimation.PAUSE_TO_PLAY,
          [styles.play]: eqAnimation === EqAnimation.PLAYING,
          [styles.playToPause]: eqAnimation === EqAnimation.PLAY_TO_PAUSE,
        })}
      />
      <div
        className={classNames(styles.bar, styles.bar3, {
          [styles.pauseToPlay]: eqAnimation === EqAnimation.PAUSE_TO_PLAY,
          [styles.play]: eqAnimation === EqAnimation.PLAYING,
          [styles.playToPause]: eqAnimation === EqAnimation.PLAY_TO_PAUSE,
        })}
      />
    </div>
  );
};

const NowPlaying = ({ playing, textName }) => {
  return (
    <div className={styles.nowPlaying}>
      <Equaliser playing={playing} />
      <span className={styles.nowPlayingText}>Now Playing</span>
    </div>
  );
};

const ContextItem = ({ item, isActive }) => {
  const { shelfStore } = useCarThingStore();
  const uiState = shelfStore.shelfController.shelfSwiperItemUiState;
  const { uri, image_id: imageId, title, subtitle, category } = item;
  const { ref, inView } = useInView();
  const [touchDown, setTouchDown] = useState(false);

  useEffect(() => {
    if (inView) {
      runInAction(() => uiState.logContextItemImpression(uri, category));
    }
  }, [category, uiState, inView, uri]);

  return (
    <div
      ref={ref}
      className={classNames(styles.item, {
        [shelfSwiperItemStyles.activeSlide]: isActive,
        [shelfSwiperItemStyles.pressed]: touchDown || (isActive && uiState.isDialPressed),
      })}
      {...pointerListenersMaker(setTouchDown)}
      onClick={() => uiState.artworkClicked(item)}
    >
      <LazyImage
        size={ARTWORK_WIDTH}
        imageId={imageId}
        uri={uri || ''}
        innerBorder
        isActive={isActive}
      />
      <div className={styles.titleContainer}>
        <div className={styles.title}>
          {uiState.graphQlEnabled ? title : getShelfItemTitle(title, uri)}
        </div>
      </div>
      <div className={styles.subtitle}>
        {uiState.showNowPlaying(uri) ? (
          <NowPlaying playing={uiState.isPlaying} textName="balladBook" />
        ) : (
          subtitle
        )}
      </div>
    </div>
  );
};

export default ContextItem;
