import { useState, useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useCarThingStore } from '../../contexts/CarThingStore';
import LearnVoiceStep from './LearnVoiceStep';

const EXIT_DURATION = 1300;

const LearnVoice = ({ dataReady }) => {
  const { onboardingStore } = useCarThingStore();
  const targetStep = onboardingStore.learnVoiceStep;

  // renderedStep is what's actually shown — it lags behind targetStep during exit
  const [renderedStep, setRenderedStep] = useState(targetStep);
  const [exiting, setExiting] = useState(false);
  const prevTargetRef = useRef(targetStep);

  useEffect(() => {
    if (targetStep === prevTargetRef.current) return;
    prevTargetRef.current = targetStep;

    // Start exit animation on the current rendered step
    setExiting(true);

    const timer = setTimeout(() => {
      // After exit completes, swap to the new step and clear exiting
      setRenderedStep(targetStep);
      setExiting(false);
    }, EXIT_DURATION);

    return () => clearTimeout(timer);
  }, [targetStep]);

  return (
    <div
      style={{
        position: 'relative',
        width: 800,
        height: 480,
        background: '#000',
        overflow: 'hidden',
      }}
      data-testid="onboarding-learn-voice"
    >
      <LearnVoiceStep
        key={renderedStep}
        stepId={renderedStep}
        exiting={exiting}
        dataReady={dataReady}
      />
    </div>
  );
};

export default observer(LearnVoice);
