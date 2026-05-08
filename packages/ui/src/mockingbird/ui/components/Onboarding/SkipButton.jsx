import { useState, useRef, useEffect } from "react";
import { observer } from "mobx-react-lite";
import { useCarThingStore } from "../../contexts/CarThingStore";
import { LearnVoiceStepId, TTS } from "../../stores/OnboardingStore";
import styles from "./SkipButton.module.scss";

const SkipButton = () => {
  const { onboardingStore, voiceStore } = useCarThingStore();
  const [pressedSkip, setPressedSkip] = useState(false);
  const [animClass, setAnimClass] = useState(styles.animationEnter);
  const mounted = useRef(false);

  useEffect(() => {
    requestAnimationFrame(() => {
      mounted.current = true;
      setAnimClass(`${styles.animationEnter} ${styles.animationEnterActive}`);
    });
  }, []);

  const advance = () => {
    if (voiceStore?.error) {
      onboardingStore.nextLearnVoiceStep();
      return;
    }
    if (onboardingStore.learnVoiceStep === LearnVoiceStepId.LAST_STEP) {
      onboardingStore.playTts(TTS.END_TOUR_VIA_SKIP.fileName);
      onboardingStore.setOnboardingFinished();
    } else {
      onboardingStore.setLearnVoiceStep(LearnVoiceStepId.LAST_STEP);
    }
  };

  const label = voiceStore?.error ? "Next" : "Skip";

  return (
    <div
      className={`${styles.skipButtonWrapper} ${pressedSkip ? styles.pressed : ""} ${animClass}`}
      onClick={() => advance()}
      onPointerDown={() => setPressedSkip(true)}
      onPointerUp={() => setPressedSkip(false)}
      onPointerCancel={() => setPressedSkip(false)}
    >
      {label}
    </div>
  );
};

export default observer(SkipButton);
