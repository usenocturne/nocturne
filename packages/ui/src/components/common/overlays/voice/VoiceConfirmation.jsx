import {
  CheckIcon,
  HeartIcon,
  HeartIconFilled,
  PlayIcon,
  PauseIcon,
  ForwardIcon,
  BackIcon,
  ShuffleIcon,
  ShuffleActiveIcon,
  RepeatIcon,
  RepeatOneIcon,
  VolumeLoudIcon,
  MicrophoneOffIcon,
} from "../../../common/icons";
import {
  PLAY_INTENT,
  STOP_INTENT,
  SHUFFLE_ON_INTENT,
  SHUFFLE_OFF_INTENT,
  REPEAT_ON_INTENT,
  REPEAT_OFF_INTENT,
  REPEAT_ONE_INTENT,
  FOLLOW_INTENT,
  ADD_TO_COLLECTION_INTENT,
  THUMBS_UP_INTENT,
  BAN_TRACK_INTENT,
  NEXT_INTENT,
  PREVIOUS_INTENT,
  SET_PLAYBACK_SPEED_1X_INTENT,
  SET_PLAYBACK_SPEED_1POINT2X_INTENT,
  SET_PLAYBACK_SPEED_1POINT5X_INTENT,
  MUTE_MIC_INTENT,
  MUTE_INTENT,
  ADD_TO_QUEUE_INTENT,
  VOLUME_INTENT,
  SAVE_TO_COLLECTION_PODCAST_ACTION,
  SAVE_TO_COLLECTION_EPISODE,
} from "./constants";

const VoiceConfirmation = ({ intent, action }) => {
  switch (intent) {
    case THUMBS_UP_INTENT:
    case FOLLOW_INTENT:
    case ADD_TO_COLLECTION_INTENT:
      if (
        action === SAVE_TO_COLLECTION_PODCAST_ACTION ||
        action === SAVE_TO_COLLECTION_EPISODE
      ) {
        return (
          <div
            className={`voice-confirmation-icon voice-confirmation-icon--${intent}`}
          >
            <CheckIcon width={32} height={32} />
          </div>
        );
      }
      return (
        <div
          className={`voice-confirmation-icon voice-confirmation-icon--${intent}`}
        >
          <HeartIconFilled width={32} height={32} />
        </div>
      );
    case SHUFFLE_ON_INTENT:
      return (
        <div
          className={`voice-confirmation-icon voice-confirmation-icon--${intent}`}
        >
          <ShuffleActiveIcon width={32} height={32} />
        </div>
      );
    case SHUFFLE_OFF_INTENT:
      return (
        <div
          className={`voice-confirmation-icon voice-confirmation-icon--${intent}`}
        >
          <ShuffleIcon width={32} height={32} />
        </div>
      );
    case REPEAT_ON_INTENT:
    case REPEAT_OFF_INTENT:
      return (
        <div
          className={`voice-confirmation-icon voice-confirmation-icon--${intent}`}
        >
          <RepeatIcon width={32} height={32} />
        </div>
      );
    case REPEAT_ONE_INTENT:
      return (
        <div
          className={`voice-confirmation-icon voice-confirmation-icon--${intent}`}
        >
          <RepeatOneIcon width={32} height={32} />
        </div>
      );
    case SET_PLAYBACK_SPEED_1X_INTENT:
    case SET_PLAYBACK_SPEED_1POINT2X_INTENT:
    case SET_PLAYBACK_SPEED_1POINT5X_INTENT:
      return null;
    case MUTE_INTENT:
    case MUTE_MIC_INTENT:
      return (
        <div
          className={`voice-confirmation-icon voice-confirmation-icon--${intent}`}
        >
          <MicrophoneOffIcon width={32} height={32} />
        </div>
      );
    case VOLUME_INTENT:
      return (
        <div
          className={`voice-confirmation-icon voice-confirmation-icon--${intent}`}
        >
          <VolumeLoudIcon width={32} height={32} />
        </div>
      );
    case PLAY_INTENT:
      return (
        <div
          className={`voice-confirmation-icon voice-confirmation-icon--${intent}`}
        >
          <PlayIcon width={32} height={32} />
        </div>
      );
    case STOP_INTENT:
      return (
        <div
          className={`voice-confirmation-icon voice-confirmation-icon--${intent}`}
        >
          <PauseIcon width={32} height={32} />
        </div>
      );
    case NEXT_INTENT:
      return (
        <div
          className={`voice-confirmation-icon voice-confirmation-icon--${intent}`}
        >
          <ForwardIcon width={32} height={32} />
        </div>
      );
    case PREVIOUS_INTENT:
      return (
        <div
          className={`voice-confirmation-icon voice-confirmation-icon--${intent}`}
        >
          <BackIcon width={32} height={32} />
        </div>
      );
    case ADD_TO_QUEUE_INTENT:
      return (
        <div
          className={`voice-confirmation-icon voice-confirmation-icon--${intent}`}
        >
          <CheckIcon width={32} height={32} />
        </div>
      );
    case BAN_TRACK_INTENT:
      return (
        <div
          className={`voice-confirmation-icon voice-confirmation-icon--${intent}`}
        >
          <HeartIcon width={32} height={32} />
        </div>
      );
    default:
      return (
        <div
          className={`voice-confirmation-icon voice-confirmation-icon--${intent}`}
        >
          <CheckIcon width={32} height={32} />
        </div>
      );
  }
};

export default VoiceConfirmation;
