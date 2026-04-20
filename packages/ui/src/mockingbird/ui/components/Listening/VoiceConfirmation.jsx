import styles from "./VoiceConfirmation.module.scss";
import IconHeartActive48 from "../Icons/CarthingUIComponents/IconHeartActive48";
import IconCheck32 from "../Icons/CarthingUIComponents/IconCheck32";
import IconCheckAlt48 from "../Icons/CarthingUIComponents/IconCheckAlt48";
import IconShuffleActive from "../Icons/CarthingUIComponents/IconShuffleActive";
import IconShuffle from "../Icons/CarthingUIComponents/IconShuffle";
import IconRepeat from "../Icons/CarthingUIComponents/IconRepeat";
import IconRepeatOne from "../Icons/CarthingUIComponents/IconRepeatOne";
import IconMicOff64 from "../Icons/CarthingUIComponents/IconMicOff64";
import IconPlaybackSpeed1X48 from "../Icons/CarthingUIComponents/IconPlaybackSpeed1X48";
import IconPlaybackSpeed1Point2X48 from "../Icons/CarthingUIComponents/IconPlaybackSpeed1Point2X48";
import IconPlaybackSpeed1Point5X48 from "../Icons/CarthingUIComponents/IconPlaybackSpeed1Point5X48";
import IconPlay48 from "../Icons/CarthingUIComponents/IconPlay48";
import IconPause48 from "../Icons/CarthingUIComponents/IconPause48";
import IconSkipForward48 from "../Icons/CarthingUIComponents/IconSkipForward48";
import IconSkipBack48 from "../Icons/CarthingUIComponents/IconSkipBack48";
import IconHeart48 from "../Icons/CarthingUIComponents/IconHeart48";
import {
  ADD_TO_COLLECTION_INTENT,
  ADD_TO_QUEUE_INTENT,
  BAN_TRACK_INTENT,
  FOLLOW_INTENT,
  MUTE_INTENT,
  MUTE_MIC_INTENT,
  NEXT_INTENT,
  PLAY_INTENT,
  PREVIOUS_INTENT,
  REPEAT_OFF_INTENT,
  REPEAT_ON_INTENT,
  REPEAT_ONE_INTENT,
  SET_PLAYBACK_SPEED_1POINT2X_INTENT,
  SET_PLAYBACK_SPEED_1POINT5X_INTENT,
  SET_PLAYBACK_SPEED_1X_INTENT,
  SHUFFLE_OFF_INTENT,
  SHUFFLE_ON_INTENT,
  STOP_INTENT,
  THUMBS_UP_INTENT,
} from "./VoiceConfirmationIntents";
import {
  SAVE_TO_COLLECTION_EPISODE,
  SAVE_TO_COLLECTION_PODCAST_ACTION,
} from "./VoiceConfirmationActions";

const VoiceConfirmation = ({ intent, action }) => {
  switch (intent) {
    case THUMBS_UP_INTENT:
    case FOLLOW_INTENT:
    case ADD_TO_COLLECTION_INTENT:
      if (
        action === SAVE_TO_COLLECTION_PODCAST_ACTION ||
        action === SAVE_TO_COLLECTION_EPISODE
      ) {
        return <IconCheckAlt48 className={styles.confirmationIcon} />;
      }
      return <IconHeartActive48 className={styles.confirmationIcon} />;
    case SHUFFLE_ON_INTENT:
      return (
        <div data-testid="shuffle-confirmation">
          <IconShuffleActive className={styles.confirmationIcon} />
        </div>
      );
    case SHUFFLE_OFF_INTENT:
      return (
        <div data-testid="shuffle-confirmation">
          <IconShuffle className={styles.confirmationIcon} />
        </div>
      );
    case REPEAT_ON_INTENT:
      return <IconRepeat className={styles.confirmationIcon} />;
    case REPEAT_OFF_INTENT:
      return <IconRepeat className={styles.confirmationIcon} />;
    case REPEAT_ONE_INTENT:
      return <IconRepeatOne className={styles.confirmationIcon} />;
    case SET_PLAYBACK_SPEED_1X_INTENT:
      return <IconPlaybackSpeed1X48 className={styles.confirmationIcon} />;
    case SET_PLAYBACK_SPEED_1POINT2X_INTENT:
      return (
        <IconPlaybackSpeed1Point2X48 className={styles.confirmationIcon} />
      );
    case SET_PLAYBACK_SPEED_1POINT5X_INTENT:
      return (
        <IconPlaybackSpeed1Point5X48 className={styles.confirmationIcon} />
      );
    case MUTE_INTENT:
    case MUTE_MIC_INTENT:
      return (
        <div data-testid="mute-confirmation">
          <IconMicOff64 className={styles.confirmationIcon} />
        </div>
      );
    case PLAY_INTENT:
      return <IconPlay48 className={styles.confirmationIcon} />;
    case STOP_INTENT:
      return <IconPause48 className={styles.confirmationIcon} />;
    case NEXT_INTENT:
      return <IconSkipForward48 className={styles.confirmationIcon} />;
    case PREVIOUS_INTENT:
      return <IconSkipBack48 className={styles.confirmationIcon} />;
    case ADD_TO_QUEUE_INTENT:
      return (
        <div data-testid="queue-confirmation">
          <IconCheckAlt48 className={styles.confirmationIcon} />
        </div>
      );
    case BAN_TRACK_INTENT:
      return (
        <div data-testid="remove-confirmation">
          <IconHeart48 className={styles.confirmationIcon} />
        </div>
      );
    default:
      return (
        <IconCheck32
          data-testid="default-confirmation"
          className={styles.confirmationIcon}
        />
      );
  }
};

export default VoiceConfirmation;
