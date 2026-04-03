import {
  IconPlaybackSpeed0Point5X48,
  IconPlaybackSpeed0Point8X48,
  IconPlaybackSpeed1X48,
  IconPlaybackSpeed1Point2X48,
  IconPlaybackSpeed1Point5X48,
  IconPlaybackSpeed1Point8X48,
  IconPlaybackSpeed2X48,
  IconPlaybackSpeed2Point5X48,
  IconPlaybackSpeed3X48,
  IconPlaybackSpeed3Point5X48,
} from '../../../Icons/CarthingUIComponents';
import ControlButton from './ControlButton';
import { useCarThingStore } from '../../../../contexts/CarThingStore';
import { observer } from 'mobx-react-lite';

const getSpeedIcon = (podcastSpeed) => {
  switch (podcastSpeed) {
    case 0.5:
      return <IconPlaybackSpeed0Point5X48 />;
    case 0.8:
      return <IconPlaybackSpeed0Point8X48 />;
    case 1:
      return <IconPlaybackSpeed1X48 />;
    case 1.2:
      return <IconPlaybackSpeed1Point2X48 />;
    case 1.5:
      return <IconPlaybackSpeed1Point5X48 />;
    case 1.8:
      return <IconPlaybackSpeed1Point8X48 />;
    case 2:
      return <IconPlaybackSpeed2X48 />;
    case 2.5:
      return <IconPlaybackSpeed2Point5X48 />;
    case 3:
      return <IconPlaybackSpeed3X48 />;
    case 3.5:
      return <IconPlaybackSpeed3Point5X48 />;
    default:
      return <IconPlaybackSpeed1X48 />;
  }
};

const PodcastSpeed = () => {
  const { npvStore } = useCarThingStore();
  const uiState = npvStore.controlButtonsUiState;

  return (
    <ControlButton
      id="PODCAST_SPEED"
      onClick={uiState.handlePodcastSpeedClick}
    >
      <div data-testid={`speed-icon-${uiState.podcastSpeed}`}>
        {getSpeedIcon(uiState.podcastSpeed)}
      </div>
    </ControlButton>
  );
};

export default observer(PodcastSpeed);
