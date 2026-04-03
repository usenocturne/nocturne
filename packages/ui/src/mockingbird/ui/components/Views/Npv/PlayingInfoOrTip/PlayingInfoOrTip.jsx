import PlayingInfo from '../PlayingInfo/PlayingInfo';
import Tips from '../Tips/Tips';
import { useCarThingStore } from '../../../../contexts/CarThingStore';
import { observer } from 'mobx-react-lite';
import CSSTransition from '../../../CSSTransitionCompat';
import { SwitchTransition } from 'react-transition-group';
import styles from './PlayingInfoOrTip.module.scss';

const playingInfoAnim = {
  enter: styles.playingInfoEnter,
  enterActive: styles.playingInfoEnterActive,
  exit: styles.playingInfoExit,
  exitActive: styles.playingInfoExitActive,
};

const tipAnim = {
  enter: styles.tipEnter,
  enterActive: styles.tipEnterActive,
  exit: styles.tipExit,
  exitActive: styles.tipExitActive,
};

const PlayingInfoOrTip = () => {
  const { npvStore } = useCarThingStore();
  const uiState = npvStore.tipsUiState;

  return (
    <div className={styles.playingInfoOrTip}>
      <SwitchTransition>
        <CSSTransition
          key={uiState.tipToShow ? 1 : 0}
          timeout={300}
          classNames={uiState.tipToShow ? tipAnim : playingInfoAnim}
          children={uiState.tipToShow ? <Tips /> : <PlayingInfo />}
        />
      </SwitchTransition>
    </div>
  );
};

export default observer(PlayingInfoOrTip);