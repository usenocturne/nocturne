import { observer } from 'mobx-react-lite';
import { useEffect, useState, useRef } from 'react';
import { runInAction } from 'mobx';
import { useCarThingStore } from '../../contexts/CarThingStore';
import { delayedAction, TTS } from '../../stores/OnboardingStore';
import { transitionDurationMs } from '../../styles/Variables';
import Main from '../Main';
import DialTurnDots from './DialTurnDots';
import DialPressPulse from './DialPressPulse';
import BackPressBanner from './BackPressBanner';
import NoInteractionModal from './NoInteractionModal';
import styles from './LearnTactile.module.scss';

const TIME_TO_NO_INTERACTION_MODAL = 10000;
const OVERLAY_TRANSITION_MS = 300;

const LearnTactile = () => {
  const { onboardingStore, viewStore } = useCarThingStore();

  const [showDialTurnDots, setShowDialTurnDots] = useState(false);
  const [showDialPressPulse, setShowDialPressPulse] = useState(false);
  const [showBackPressBanner, setShowBackPressBanner] = useState(false);
  const noInteractionTimeoutId = useRef();

  const [modalMounted, setModalMounted] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const modalTimerRef = useRef();

  const isModalActive = !!onboardingStore.noInteractionModal;

  useEffect(() => {
    clearTimeout(modalTimerRef.current);
    if (isModalActive) {
      setModalMounted(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setModalVisible(true));
      });
    } else {
      setModalVisible(false);
      modalTimerRef.current = setTimeout(() => setModalMounted(false), OVERLAY_TRANSITION_MS);
    }
    return () => clearTimeout(modalTimerRef.current);
  }, [isModalActive]);

  const startNoInteractionTimer = () => {
    window.clearTimeout(noInteractionTimeoutId.current);
    noInteractionTimeoutId.current = window.setTimeout(() => {
      onboardingStore.showNoInteractionModal();
    }, TIME_TO_NO_INTERACTION_MODAL);
  };

  useEffect(() => {
    let mounted = true;

    const setup = async () => {
      
      viewStore.backToContentShelf();

      onboardingStore.setDialPressEnabled(false);
      onboardingStore.setDialTurnEnabled(false);
      onboardingStore.setBackEnabled(false);

      await onboardingStore.waitForTts(TTS.SHELF_EXPLAIN);

      if (mounted) {
        
        onboardingStore.playTts(TTS.SHELF_DIAL_TURN.fileName);

        runInAction(() => {
          onboardingStore.setDialTurnEnabled(true);
        });
        setShowDialTurnDots(true);
        startNoInteractionTimer();
      }
    };

    setup();

    return () => {
      mounted = false;
      window.clearTimeout(noInteractionTimeoutId.current);
    };
  }, []); 

  useEffect(() => {
    switch (onboardingStore.dialTurnCounter) {
      case 1:
        startNoInteractionTimer();
        break;
      case 2:
        window.clearTimeout(noInteractionTimeoutId.current);
        runInAction(() => {
          onboardingStore.setDialTurnEnabled(false);
        });
        setShowDialTurnDots(false);

        onboardingStore.playTts(TTS.SHELF_DIAL_PRESS.fileName);

        setShowDialPressPulse(true);
        runInAction(() => {
          onboardingStore.setDialPressEnabled(true);
        });
        startNoInteractionTimer();
        break;
      default:
        break;
    }
  }, [onboardingStore.dialTurnCounter]); 

  useEffect(() => {
    const handleDialPress = async () => {
      switch (onboardingStore.dialPressCounter) {
        case 1: {
          
          window.clearTimeout(noInteractionTimeoutId.current);

          onboardingStore.playTts(TTS.TRACKLIST_DIAL_PRESS.fileName);

          await delayedAction(() => {}, transitionDurationMs);
          runInAction(() => {
            if (onboardingStore.isOnboardingOngoing) {
              onboardingStore.setDialTurnEnabled(true);
              startNoInteractionTimer();
            }
          });
          break;
        }
        case 2: {
          
          window.clearTimeout(noInteractionTimeoutId.current);
          runInAction(() => {
            onboardingStore.setDialTurnEnabled(false);
            onboardingStore.setDialPressEnabled(false);
          });
          setShowDialPressPulse(false);

          await onboardingStore.waitForTts(TTS.NPV_EXPLAIN);

          onboardingStore.playTts(TTS.NPV_DIAL_PRESS.fileName);

          setShowDialPressPulse(true);
          runInAction(() => {
            onboardingStore.setDialPressEnabled(true);
          });
          startNoInteractionTimer();
          break;
        }
        case 3: {
          
          window.clearTimeout(noInteractionTimeoutId.current);
          setShowDialPressPulse(false);
          runInAction(() => {
            onboardingStore.setDialPressEnabled(false);
          });

          await onboardingStore.waitForTts(TTS.NPV_BACK_PRESS);

          setShowBackPressBanner(true);
          runInAction(() => {
            onboardingStore.setBackEnabled(true);
          });
          startNoInteractionTimer();
          break;
        }
        default:
          break;
      }
    };

    handleDialPress();
  }, [onboardingStore.dialPressCounter]); 

  useEffect(() => {
    const handleBack = async () => {
      switch (onboardingStore.backCounter) {
        case 1: {
          
          onboardingStore.playTts(TTS.TRACKLIST_BACK_PRESS.fileName);
          startNoInteractionTimer();
          break;
        }
        case 2: {
          
          window.clearTimeout(noInteractionTimeoutId.current);

          await onboardingStore.waitForTts(TTS.SHELF_BACK_PRESS);

          startNoInteractionTimer();
          break;
        }
        case 3: {
          
          window.clearTimeout(noInteractionTimeoutId.current);
          setShowBackPressBanner(false);

          await onboardingStore.waitForTts(TTS.END_TOUR);

          onboardingStore.setOnboardingFinished();
          break;
        }
        default:
          break;
      }
    };

    handleBack();
  }, [onboardingStore.backCounter]); 

  return (
    <div className={styles.learnTactile} data-testid="onboarding-learn-tactile">
      <Main />
      {showDialTurnDots && <DialTurnDots />}
      {showDialPressPulse && <DialPressPulse />}
      {showBackPressBanner && <BackPressBanner />}
      {!isModalActive && (
        <div className={styles.blockTouch} />
      )}
      {modalMounted && <NoInteractionModal visible={modalVisible} />}
    </div>
  );
};

export default observer(LearnTactile);
