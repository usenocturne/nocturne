import { IconShuffle48, IconShuffleActive48, IconDJ48 } from '../../../Icons/CarthingUIComponents';
import { useCarThingStore } from '../../../../contexts/CarThingStore';
import { observer } from 'mobx-react-lite';
import { NpvIcon } from './Controls';
import ControlButton from './ControlButton';
import styles from './Controls.module.scss';

const Shuffle = () => {
  const { npvStore, playerStore, spotifyControls, currentPlayback } = useCarThingStore();
  const uiState = npvStore.controlButtonsUiState;

  const isDJPlaylist = currentPlayback?.context?.uri === "spotify:playlist:37i9dQZF1EYkqdzj48dyYq";

  const handleClick = () => {
    if (isDJPlaylist) {
      spotifyControls.sendDJSignal(currentPlayback?.device?.id);
    } else {
      if (uiState.isShuffled) {
        uiState.handleUnshuffleClick();
      } else {
        uiState.handleShuffleClick();
      }
    }
  };

  return (
    <ControlButton
      id={isDJPlaylist ? 'DJ_SIGNAL' : (uiState.isShuffled ? NpvIcon.UNSHUFFLE : NpvIcon.SHUFFLE)}
      onClick={handleClick}
      isDisabled={isDJPlaylist ? false : !playerStore.canToggleShuffle}
    >
      {isDJPlaylist ? (
        <IconDJ48 />
      ) : uiState.isShuffled ? (
        <div className={styles.iconShuffleActive}>
          <IconShuffleActive48 />
        </div>
      ) : (
        <IconShuffle48 />
      )}
    </ControlButton>
  );
};

export default observer(Shuffle);
