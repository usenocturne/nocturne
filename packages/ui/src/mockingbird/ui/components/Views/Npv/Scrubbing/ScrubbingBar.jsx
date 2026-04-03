import { useCarThingStore } from '../../../../contexts/CarThingStore';
import { observer } from 'mobx-react-lite';
import styles from './ScrubbingBar.module.scss';

const ScrubbingBar = ({ playbackProgress }) => {
  const { npvStore } = useCarThingStore();
  const uiState = npvStore.scrubbingUiState;
  const { colorChannels } = uiState;
  const progressPercent = playbackProgress?.progressPercentage || uiState.trackPlayedPercent * 100;

  return (
    <div
      className={styles.scrubbingBar}
      style={{
        backgroundColor: `rgb(${colorChannels.join(',')})`,
      }}
      data-testid="scrubbing-bar"
    >
      <div
        className={styles.progressPlayed}
        style={{
          transform: `translateX(${progressPercent - 100}%)`,
        }}
      />
    </div>
  );
};

export default observer(ScrubbingBar);
