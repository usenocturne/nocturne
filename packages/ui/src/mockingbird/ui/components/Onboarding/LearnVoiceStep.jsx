import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import { useCarThingStore } from "../../contexts/CarThingStore";
import {
  delayedAction,
  LearnVoiceStepId,
  TTS,
} from "../../stores/OnboardingStore";
import SkipButton from "./SkipButton";
import Jellyfish from "../Listening/Jellyfish";
import styles from "./LearnVoiceStep.module.scss";

const firstLetterUpperCase = (s) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

const STEP_CONFIG = {
  [LearnVoiceStepId.FIRST_UP]: {
    header: "First up:",
    title: "Using your voice",
    voiceEnabled: false,
    tts1: TTS.VOICE_1_1,
    tts2: null,
  },
  [LearnVoiceStepId.VOICE_PLAY_DRIVING_MUSIC]: {
    header: "Try saying...",
    title: "Hey Spotify, play some driving music",
    voiceEnabled: true,
    tts1: TTS.VOICE_2_1,
    tts2: TTS.VOICE_2_2,
  },
  [LearnVoiceStepId.VOICE_NEXT_SONG]: {
    header: "Try saying...",
    title: "Hey Spotify, next song",
    voiceEnabled: true,
    tts1: TTS.VOICE_3_1,
    tts2: TTS.VOICE_3_2,
  },
  [LearnVoiceStepId.LAST_STEP]: {
    header: "Last step:",
    title: "Navigating around Car Thing",
    voiceEnabled: false,
    tts1: TTS.TACTILE_NAVIGATION,
    tts2: null,
  },
};

const LearnVoiceStep = ({ stepId, exiting }) => {
  const { onboardingStore, voiceStore, shelfStore } = useCarThingStore();
  const [show, setShow] = useState(false);
  const [contentClass, setContentClass] = useState(styles.contentEnter);
  const cancelledRef = useRef(false);
  const config = STEP_CONFIG[stepId];

  useEffect(() => {
    if (exiting) return;
    requestAnimationFrame(() => {
      setContentClass(`${styles.contentEnter} ${styles.contentEnterActive}`);
    });
  }, [exiting]);

  useEffect(() => {
    if (exiting) return;
    if (!config) return;

    cancelledRef.current = false;
    let advanceTimeoutId;

    voiceStore.resetVoiceSessionState();
    onboardingStore.setWakewordTriggered(false);
    onboardingStore.pause();

    if (!config.voiceEnabled) {
      advanceTimeoutId = window.setTimeout(() => {
        if (!cancelledRef.current) onboardingStore.nextLearnVoiceStep();
      }, config.tts1.fileLength + 1000);
    }

    const ttsStep1 = async () => {
      setShow(true);

      if (config.tts1) {
        if (stepId === LearnVoiceStepId.LAST_STEP) {
          if (shelfStore?.getShelfData) shelfStore.getShelfData();
        }
        await delayedAction(() => {
          if (cancelledRef.current) return;
          if (config.tts1?.fileName) {
            onboardingStore.playTts(config.tts1.fileName);
          }
        }, 1000);
      }
    };

    ttsStep1();

    return () => {
      cancelledRef.current = true;
      if (advanceTimeoutId) window.clearTimeout(advanceTimeoutId);
    };
  }, [stepId, exiting]);

  useEffect(() => {
    if (exiting) return;
    if (!config?.voiceEnabled) return;
    if (!voiceStore.intent) return;
    if (!config.tts2) return;

    let cancelled = false;
    const ttsStep2 = async () => {
      await delayedAction(() => {}, 4000);
      if (cancelled) return;
      if (config.tts2?.fileName) {
        await onboardingStore.waitForTts(config.tts2);
      }
      if (cancelled) return;
      await delayedAction(() => {
        if (!cancelled) onboardingStore.nextLearnVoiceStep();
      }, 2000);
    };

    ttsStep2();
    return () => {
      cancelled = true;
    };
  }, [voiceStore.intent, exiting, config]);

  if (!config) return null;

  const voiceActive =
    config.voiceEnabled &&
    onboardingStore.wakewordTriggered &&
    !voiceStore.error;

  const transcript =
    config.voiceEnabled &&
    !voiceStore.error &&
    voiceStore.state.asr.isFinal &&
    voiceStore.state.asr.transcript;

  const showHeader = show && !transcript && !voiceStore.error;
  const dimPrompt = voiceActive && !transcript;

  return (
    <div className={styles.learnVoiceStep}>
      <div className={styles.headerAndTitle}>
        <div
          className={
            exiting
              ? `${styles.contentExit} ${styles.contentExitActive}`
              : contentClass
          }
        >
          <div className={dimPrompt ? styles.voiceActive : undefined}>
            {showHeader && <div className={styles.header}>{config.header}</div>}
            {show &&
              (voiceStore.error ? (
                <div className={styles.transition}>
                  <div className={styles.errorContent}>
                    That didn&apos;t work, you might be offline.
                  </div>
                  <div className={styles.errorContent}>
                    That&apos;s OK, let&apos;s move on.
                  </div>
                </div>
              ) : (
                <div className={styles.title}>
                  {transcript ? firstLetterUpperCase(transcript) : config.title}
                </div>
              ))}
          </div>
        </div>
      </div>
      <div className={styles.skipOrJellyfish}>
        {!exiting && !voiceActive && <SkipButton />}
        {!exiting && voiceActive && (
          <div className={styles.jellyfishContainer} data-testid="jellyfish">
            <Jellyfish voiceStore={voiceStore} />
          </div>
        )}
      </div>
    </div>
  );
};

export default observer(LearnVoiceStep);
