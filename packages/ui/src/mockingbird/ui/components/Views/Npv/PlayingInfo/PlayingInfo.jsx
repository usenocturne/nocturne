import Artwork from './Artwork';
import PlayingInfoHeader from './PlayingInfoHeader';
import PlayingInfoTitles from './PlayingInfoTitles/PlayingInfoTitles';
import StatusIcons from './StatusIcons';
import { useCarThingStore } from '../../../../contexts/CarThingStore';
import { observer } from 'mobx-react-lite';
import { useSwipeable } from 'react-swipeable';
import { SwipeDirection } from '../SwipeHandler/SwipeHandler';
import styles from './PlayingInfo.module.scss';

const PlayingInfo = () => {
  const { npvStore } = useCarThingStore();
  const uiState = npvStore.playingInfoUiState;

  const getAnimationEnterDirection = () => {
    switch (uiState.swipeHandler.swipeDirection) {
      case SwipeDirection.LEFT:
        return styles.animationEnterRight;
      case SwipeDirection.RIGHT:
        return styles.animationEnterLeft;
      default:
        return undefined;
    }
  };

  const getAnimationExitDirection = () => {
    switch (uiState.swipeHandler.swipeDirection) {
      case SwipeDirection.LEFT:
        return styles.animationExitLeft;
      case SwipeDirection.RIGHT:
        return styles.animationExitRight;
      default:
        return undefined;
    }
  };

  const getAnimationClassNames = () => {
    return {
      enter: getAnimationEnterDirection(),
      enterActive: styles.animationEnterActive,
      exit: styles.animationExit,
      exitActive: getAnimationExitDirection(),
    };
  };

  const tracks = [uiState.currentItem];

  return (
    <div
      className={styles.playingInfo}
      data-testid="npv-playing-info"
    >
      <Artwork
        tracks={tracks}
        getAnimationClassNames={getAnimationClassNames}
      />
      <div className={styles.info}>
        <div className={styles.playingInfoHeader}>
          <PlayingInfoHeader />
          <StatusIcons />
        </div>
        <PlayingInfoTitles
          tracks={tracks}
          getAnimationClassNames={getAnimationClassNames}
        />
      </div>
    </div>
  );
};

export default observer(PlayingInfo);