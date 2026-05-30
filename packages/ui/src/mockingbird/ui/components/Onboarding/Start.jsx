import { useEffect } from "react";
import { observer } from "mobx-react-lite";
import { useCarThingStore } from "../../contexts/CarThingStore";
import { TTS } from "../../stores/OnboardingStore";
import styles from "./Start.module.scss";

const Start = ({ dataReady }) => {
  const { onboardingStore } = useCarThingStore();

  useEffect(() => {
    if (dataReady) {
      onboardingStore.playTts(TTS.START.fileName);
    }
  }, [dataReady, onboardingStore]);

  const handleClick = () => {
    if (dataReady) {
      onboardingStore.handleStartClick();
    }
  };

  return (
    <div
      className={styles.start}
      onPointerDown={handleClick}
      data-testid="onboarding-start"
    >
      <div className={styles.title}>Car Thing is ready.</div>
      <div className={styles.tourAction}>
        <div className={styles.subtitle}>
          {dataReady ? "Take a tour" : "Loading..."}
        </div>
        <div
          className={styles.arrowWrapper}
          style={!dataReady ? { opacity: 0.4 } : undefined}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M1 8h14M9 2l6 6-6 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </div>
  );
};

export default observer(Start);
