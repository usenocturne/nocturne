import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useCarThingStore } from '../../contexts/CarThingStore';
import { LearnVoiceStepId, TTS } from '../../stores/OnboardingStore';
import { sendNocturneWsRequest } from '../../../../hooks/useNocturned';
import SkipButton from './SkipButton';
import styles from './LearnVoiceStep.module.scss';

const STEP_CONFIG = {
  [LearnVoiceStepId.FIRST_UP]: {
    header: 'First up:',
    title: 'Using your voice',
    tts1: TTS.VOICE_1_1,
    tts2: null,
  },
  [LearnVoiceStepId.VOICE_PLAY_DRIVING_MUSIC]: {
    header: 'Try saying...',
    title: 'Hey Spotify, play some driving music',
    tts1: TTS.VOICE_2_1,
    tts2: TTS.VOICE_2_2,
  },
  [LearnVoiceStepId.VOICE_NEXT_SONG]: {
    header: 'Try saying...',
    title: 'Hey Spotify, next song',
    tts1: TTS.VOICE_3_1,
    tts2: TTS.VOICE_3_2,
  },
  [LearnVoiceStepId.LAST_STEP]: {
    header: 'Last step:',
    title: 'Navigating around Car Thing',
    tts1: TTS.TACTILE_NAVIGATION,
    tts2: null,
  },
};

const ON_REPEAT_URI = 'spotify:playlist:37i9dQZF1Epfk5F9npafJr';

const LearnVoiceStep = ({ stepId, dataReady, exiting }) => {
  const { onboardingStore, spotifyControls, shelfStore } = useCarThingStore();
  const timersRef = useRef([]);
  const [contentClass, setContentClass] = useState(styles.contentEnter);

  // Content enter animation
  useEffect(() => {
    if (exiting) return;
    requestAnimationFrame(() => {
      setContentClass(`${styles.contentEnter} ${styles.contentEnterActive}`);
    });
  }, [exiting]);

  // TTS-driven step progression (matching original superbird-webapp flow)
  useEffect(() => {
    if (exiting) return;
    let cancelled = false;
    timersRef.current = [];

    const addTimer = (fn, delay) => {
      const id = setTimeout(() => { if (!cancelled) fn(); }, delay);
      timersRef.current.push(id);
    };

    const config = STEP_CONFIG[stepId];
    if (!config) return;

    switch (stepId) {
      case LearnVoiceStepId.FIRST_UP: {
        // Play TTS intro, wait for it, then advance
        onboardingStore.playTts(config.tts1.fileName);
        addTimer(() => onboardingStore.nextLearnVoiceStep(), config.tts1.fileLength + 1000);
        break;
      }

      case LearnVoiceStepId.VOICE_PLAY_DRIVING_MUSIC: {
        // Play "Hey Spotify, play some driving music" prompt
        onboardingStore.playTts(config.tts1.fileName);
        // After prompt finishes, trigger play and play response TTS
        addTimer(() => {
          sendNocturneWsRequest('spotify.player.play', {
            context_uri: ON_REPEAT_URI,
          }).catch((e) => console.warn('Failed to play driving music:', e));
          onboardingStore.playTts(config.tts2.fileName);
        }, config.tts1.fileLength + 1000);
        // After response TTS finishes, advance
        addTimer(
          () => onboardingStore.nextLearnVoiceStep(),
          config.tts1.fileLength + 1000 + config.tts2.fileLength + 1000,
        );
        break;
      }

      case LearnVoiceStepId.VOICE_NEXT_SONG: {
        // Play "Hey Spotify, next song" prompt
        onboardingStore.playTts(config.tts1.fileName);
        // After prompt, skip track and play response TTS
        addTimer(() => {
          spotifyControls?.skipToNext?.();
          onboardingStore.playTts(config.tts2.fileName);
        }, config.tts1.fileLength + 1000);
        // After response, advance
        addTimer(
          () => onboardingStore.nextLearnVoiceStep(),
          config.tts1.fileLength + 1000 + config.tts2.fileLength + 1000,
        );
        break;
      }

      case LearnVoiceStepId.LAST_STEP: {
        // Play "Navigating around Car Thing" TTS
        onboardingStore.playTts(config.tts1.fileName);
        if (shelfStore?.getShelfData) {
          shelfStore.getShelfData();
        }
        // After TTS, advance to tactile
        addTimer(
          () => onboardingStore.nextLearnVoiceStep(),
          config.tts1.fileLength + 1000,
        );
        break;
      }

      default:
        break;
    }

    return () => {
      cancelled = true;
      timersRef.current.forEach(clearTimeout);
    };
  }, [stepId]); // eslint-disable-line react-hooks/exhaustive-deps

  const config = STEP_CONFIG[stepId];
  if (!config) return null;

  return (
    <div className={styles.learnVoiceStep}>
      <div className={styles.headerAndTitle}>
        <div className={exiting ? `${styles.contentExit} ${styles.contentExitActive}` : contentClass}>
          <div className={styles.header}>{config.header}</div>
          <div className={styles.title}>{config.title}</div>
        </div>
      </div>
      <div className={styles.skipOrJellyfish}>
        {!exiting && <SkipButton />}
      </div>
    </div>
  );
};

export default observer(LearnVoiceStep);
