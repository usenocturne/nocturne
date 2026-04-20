import classnames from "classnames";
import { observer } from "mobx-react-lite";
import styles from "./Listening.module.scss";
import VoiceConfirmation from "./VoiceConfirmation";
import VolumeConfirmation from "./VolumeConfirmation";
import Jellyfish from "./Jellyfish";
import { useCarThingStore } from "../../contexts/CarThingStore";
import Type from "../CarthingUIComponents/Type/Type";
import AutoSizingText from "./AutoSizingText";
import { VOLUME_INTENT } from "./VoiceConfirmationIntents";

const firstLetterUpperCase = (s) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

const INTENT_TO_CONFIRMATION_TEXT = {
  ADD_TO_COLLECTION: "Saved",
  THUMBS_UP: "Saved",
  BAN_TRACK: "Removed",
  SHUFFLE_ON: "Shuffle on",
  SHUFFLE_OFF: "Shuffle off",
  REPEAT_ON: "Repeat on",
  REPEAT_ONE: "Repeat one on",
  REPEAT_OFF: "Repeat off",
  SET_PLAYBACK_SPEED_1POINT5X: "Playback speed set",
  SET_PLAYBACK_SPEED_1POINT2X: "Playback speed set",
  SET_PLAYBACK_SPEED_1X: "Playback speed set",
  MUTE_MIC: "Microphone off",
  PLAY: "Playing",
  STOP: "Paused",
  NEXT: "Next",
  PREVIOUS: "Previous",
  ADD_TO_QUEUE: "Added to queue",
};

const ACTION_TO_CONFIRMATION_TEXT = {
  SAVE_TO_COLLECTION_PODCAST: "Added",
};

export function Listening({
  maybeTryAgain,
  errorUiTitle,
  errorUiSubtitle,
  error,
  confirmationText,
  friendlyError,
  showingVoiceConfirmation,
  intent,
  action,
  transcript,
  isFinal,
  isError,
  listening,
  aiResponse,
  voiceStore,
}) {
  let content = null;
  let showJellyfish = true;

  if (errorUiTitle) {
    content = (
      <Type name="brioBold" className={styles.fadeIn}>
        <div data-testid="error-ui-title">{errorUiTitle}</div>
        <div data-testid="error-ui-subtitle">{errorUiSubtitle}</div>
      </Type>
    );
  } else if (error || friendlyError) {
    content = (
      <Type
        name="brioBold"
        className={styles.fadeIn}
        dataTestId="voice-error-text"
        style={{ whiteSpace: "pre-wrap" }}
      >
        {friendlyError || (
          <>
            <div>Sorry!</div>
            <div>Something went wrong.</div>
            <div>Tap to try again.</div>
          </>
        )}
      </Type>
    );
  } else if (confirmationText) {
    content = (
      <Type
        name="brioBold"
        className={classnames(styles.textConfirmation, styles.fadeIn)}
      >
        {confirmationText.title}
        <br />
        {confirmationText.subtitle}
      </Type>
    );
  } else if (showingVoiceConfirmation && intent === VOLUME_INTENT) {
    showJellyfish = false;
    content = (
      <div className={classnames(styles.voiceConfirmation, styles.centered)}>
        <VolumeConfirmation volumeTarget={voiceStore.state.volumeTarget} />
      </div>
    );
  } else if (showingVoiceConfirmation) {
    showJellyfish = false;
    content = (
      <div className={classnames(styles.voiceConfirmation, styles.centered)}>
        <VoiceConfirmation intent={intent} action={action} />
        <Type
          name="altoBold"
          textColor="white"
          className={styles.voiceConfirmationText}
        >
          {(action && ACTION_TO_CONFIRMATION_TEXT[action]) ||
            INTENT_TO_CONFIRMATION_TEXT[intent] ||
            ""}
        </Type>
      </div>
    );
  } else if (aiResponse) {
    content = (
      <Type
        name="brioBold"
        className={styles.fadeIn}
        dataTestId="voice-ai-response"
      >
        {aiResponse}
      </Type>
    );
  } else if (transcript && !isError) {
    content = (
      <AutoSizingText
        textContent={firstLetterUpperCase(transcript)}
        className={isFinal ? styles.fadeIn : undefined}
        maxHeight={3 * 72}
        textSizesDescending={["forteBold", "brioBold"]}
        dataTestId="voice-transcript"
      />
    );
  }

  return (
    <div
      className={classnames(styles.listeningWrapper, {
        [styles.currentlyListening]: listening,
      })}
      data-testid="voice-animation"
      onClick={maybeTryAgain}
    >
      {content}
      {showJellyfish && (
        <div className={styles.jellyfish}>
          <Jellyfish voiceStore={voiceStore} />
        </div>
      )}
    </div>
  );
}

const ListeningContainer = () => {
  const { voiceStore } = useCarThingStore();

  const maybeTryAgain = () => {
    if (voiceStore.error || voiceStore.friendlyError) {
      voiceStore.retry();
    }
  };

  const { showingVoiceConfirmation, intent, isError, listening } = voiceStore;
  const { transcript, isFinal } = voiceStore.state.asr;
  const error = voiceStore.state.error;
  const friendlyError = voiceStore.state.friendlyError;
  const confirmationText = voiceStore.state.confirmationText || null;
  const action = voiceStore.state.action;
  const aiResponse = voiceStore.state.aiResponse;

  return (
    <Listening
      maybeTryAgain={maybeTryAgain}
      errorUiTitle={null}
      errorUiSubtitle={null}
      error={error}
      confirmationText={confirmationText}
      friendlyError={friendlyError}
      showingVoiceConfirmation={showingVoiceConfirmation}
      intent={intent}
      action={action}
      transcript={transcript}
      isFinal={isFinal}
      isError={isError}
      listening={listening}
      aiResponse={aiResponse}
      voiceStore={voiceStore}
    />
  );
};

export default observer(ListeningContainer);
