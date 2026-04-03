import { useCarThingStore } from '../../../../contexts/CarThingStore';
import styles from './Scrubbing.module.scss';
import { observer } from 'mobx-react-lite';
import ScrubbingBar from './ScrubbingBar';

const Scrubbing = ({ playbackProgress, onSeek }) => {
  const { npvStore } = useCarThingStore();
  const uiState = npvStore.scrubbingUiState;

  return (
    <>
      {uiState.isScrubbingEnabled && (
        <div
          data-testid="scrubbing-bar-touch-area"
          className={styles.scrubbingClickArea}
          onClick={() => {
            uiState.handleScrubberClick();
          }}
          style={{ cursor: 'pointer' }}
        />
      )}
      <ScrubbingBar playbackProgress={playbackProgress} onSeek={onSeek} />
    </>
  );
};

export default observer(Scrubbing);