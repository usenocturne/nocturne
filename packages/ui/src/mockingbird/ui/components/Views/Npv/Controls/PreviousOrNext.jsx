import { IconSkipBack48, IconSkipForward48 } from '../../../Icons/CarthingUIComponents';
import { SkipDirection, NpvIcon } from './Controls';
import { useCarThingStore } from '../../../../contexts/CarThingStore';
import { observer } from 'mobx-react-lite';
import ControlButton from './ControlButton';

const PreviousOrNext = ({ direction }) => {
  const { npvStore, playerStore } = useCarThingStore();
  const uiState = npvStore.controlButtonsUiState;

  const handleClick = () => {
    if (direction === SkipDirection.BACK) {
      uiState.handleSkipPrevClick();
    } else {
      uiState.handleSkipNextClick();
    }
  };

  const isBackward = direction === SkipDirection.BACK;
  const buttonId = isBackward ? NpvIcon.SKIP_PREV : NpvIcon.SKIP_NEXT;
  const isDisabled = isBackward ? !playerStore.canSkipPrev : !playerStore.canSkipNext;

  return (
    <ControlButton
      id={buttonId}
      onClick={handleClick}
      isDisabled={isDisabled}
    >
      {isBackward ? (
        <IconSkipBack48 />
      ) : (
        <IconSkipForward48 />
      )}
    </ControlButton>
  );
};

export default observer(PreviousOrNext);
