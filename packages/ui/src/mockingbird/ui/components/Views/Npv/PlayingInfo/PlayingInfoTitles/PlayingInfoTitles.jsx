import classNames from 'classnames';
import { useCarThingStore } from '../../../../../contexts/CarThingStore';
import { runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { cloneElement, createRef, useEffect, useState } from 'react';
import CSSTransition from '../../../../CSSTransitionCompat';
import { TransitionGroup } from 'react-transition-group';
import { transitionDurationMs } from '../../../../../styles/Variables';
import styles from './PlayingInfoTitles.module.scss';

const NPV_TITLE_MAX_HEIGHT = 146;

const TitleSize = {
  BIG: 'big',
  MIDDLE: 'middle',
  SMALL: 'small',
};

const SwipeDirection = {
  NONE: 'NONE',
  LEFT: 'LEFT',
  RIGHT: 'RIGHT',
};

const PlayingInfoTitles = ({ tracks, getAnimationClassNames }) => {
  const { npvStore } = useCarThingStore();
  const uiState = npvStore.playingInfoUiState;

  const [showTitle, setShowTitle] = useState(true);
  const [titleSize, setTitleSize] = useState(TitleSize.BIG);
  const [refTitle, setRefTitle] = useState('');
  const npvTitleRef = createRef();

  useEffect(() => {
    const effect = () => {
      const preRenderDiv = npvTitleRef.current;
      if (uiState.title !== refTitle) {
        setRefTitle(uiState.title);
        setShowTitle(false);
        setTitleSize(TitleSize.BIG);
      }
      if (preRenderDiv && preRenderDiv.offsetHeight > NPV_TITLE_MAX_HEIGHT) {
        if (titleSize === TitleSize.BIG) {
          setTitleSize(TitleSize.MIDDLE);
        } else if (titleSize === TitleSize.MIDDLE) {
          setTitleSize(TitleSize.SMALL);
          setShowTitle(true);
        }
      } else {
        setShowTitle(true);
      }
    };
    runInAction(effect);
  }, [npvTitleRef, refTitle, uiState.title, titleSize, showTitle]);

  return (
    <TransitionGroup
      className={styles.texts}
      enter={uiState.swipeHandler.swipeDirection !== SwipeDirection.NONE}
      childFactory={(child) => {
        return cloneElement(child, {
          timeout: transitionDurationMs,
          exit: uiState.swipeHandler.swipeDirection !== SwipeDirection.NONE,
          classNames: getAnimationClassNames(),
        });
      }}
    >
      {tracks.map((track) => (
        <CSSTransition
          key={track.uid}
          timeout={transitionDurationMs}
          className={styles.transitionContainer}
          onEntering={() =>
            uiState.swipeHandler.setSwipeDirection(SwipeDirection.NONE)
          }
        >
          <div className={styles.texts}>
            {showTitle && (
              <div
                className={classNames(styles.songTitle, {
                  [styles.songTitleBig]: titleSize === TitleSize.BIG,
                  [styles.songTitleMiddle]: titleSize === TitleSize.MIDDLE,
                  [styles.songTitleSmall]: titleSize === TitleSize.SMALL,
                })}
                data-testid="npv-track-title"
                ref={npvTitleRef}
              >
                {uiState.title}
              </div>
            )}
            <div
              className={styles.artistTitle}
              data-testid="npv-artist-title"
              onClick={uiState.handleArtistClick}
            >
              {uiState.subtitle}
            </div>
          </div>
        </CSSTransition>
      ))}
    </TransitionGroup>
  );
};

export default observer(PlayingInfoTitles);
