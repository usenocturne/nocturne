import { IconAddAlt48, IconCheckAlt48 } from '../../../Icons/CarthingUIComponents';
import { NpvIcon } from './Controls';
import { useCarThingStore } from '../../../../contexts/CarThingStore';
import { observer } from 'mobx-react-lite';
import ControlButton from './ControlButton';

const SaveEpisode = () => {
  const { npvStore } = useCarThingStore();
  const uiState = npvStore.controlButtonsUiState;

  return (
    <>
      {uiState.isSaved ? (
        <ControlButton
          id={NpvIcon.REMOVE_FROM_EPISODES}
          onClick={uiState.handleRemoveFromSavedEpisodesClick}
        >
          <IconCheckAlt48 />
        </ControlButton>
      ) : (
        <ControlButton
          id={NpvIcon.ADD_TO_EPISODES}
          onClick={uiState.handleAddToSavedEpisodesClick}
          isDisabled={uiState.isPlayingAd}
        >
          <IconAddAlt48 />
        </ControlButton>
      )}
    </>
  );
};

export default observer(SaveEpisode);
