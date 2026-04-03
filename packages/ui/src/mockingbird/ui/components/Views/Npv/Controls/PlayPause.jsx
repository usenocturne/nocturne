import { IconPause48, IconPlay48 } from '../../../Icons/CarthingUIComponents';
import { useCarThingStore } from '../../../../contexts/CarThingStore';
import { observer } from 'mobx-react-lite';
import { NpvIcon } from './Controls';
import ControlButton from './ControlButton';

const PlayPause = () => {
  const { npvStore, playerStore } = useCarThingStore();
  const uiState = npvStore.controlButtonsUiState;

  const handleClick = () => {
    if (uiState.isPlaying) {
      uiState.handlePauseClick();
    } else {
      uiState.handlePlayClick();
    }
  };

  return (
    <ControlButton
      id={uiState.isPlaying ? NpvIcon.PAUSE : NpvIcon.PLAY}
      onClick={handleClick}
      isDisabled={!playerStore.canPlay && !playerStore.canPause}
    >
      {uiState.isPlaying ? (
        <div data-testid="pause-icon">
          <IconPause48 />
        </div>
      ) : (
        <div data-testid="play-icon">
          <IconPlay48 />
        </div>
      )}
    </ControlButton>
  );
};

export default observer(PlayPause);
