import {
  IconHeart48,
  IconHeartActive48,
} from "../../../Icons/CarthingUIComponents";
import { useCarThingStore } from "../../../../contexts/CarThingStore";
import { observer } from "mobx-react-lite";
import { NpvIcon } from "./Controls";
import ControlButton from "./ControlButton";

const LikeTrack = () => {
  const { npvStore, playerStore } = useCarThingStore();
  const uiState = npvStore.controlButtonsUiState;

  const handleClick = () => {
    if (uiState.isSaved) {
      uiState.handleUnlikeClick();
    } else {
      uiState.handleLikeClick();
    }
  };

  return (
    <ControlButton
      id={uiState.isSaved ? NpvIcon.UNLIKE : NpvIcon.LIKE}
      onClick={handleClick}
      isDisabled={!playerStore.canLike && !playerStore.canUnlike}
    >
      {uiState.isSaved ? <IconHeartActive48 /> : <IconHeart48 />}
    </ControlButton>
  );
};

export default observer(LikeTrack);
