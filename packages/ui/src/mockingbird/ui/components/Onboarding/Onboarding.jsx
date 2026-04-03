import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { useCarThingStore } from '../../contexts/CarThingStore';
import { OnboardingStepId } from '../../stores/OnboardingStore';
import Start from './Start';
import LearnVoice from './LearnVoice';
import LearnTactile from './LearnTactile';

const Onboarding = ({ onComplete, dataReady }) => {
  const { onboardingStore } = useCarThingStore();

  useEffect(() => {
    onboardingStore.resetForNewOnboarding();
    onboardingStore.setOnCompleteCallback(onComplete);
    onboardingStore.setOnboardingStarted(true);

    // Launch the nocturne app so TTS audio can play
    onboardingStore.launchApp();

    return () => {
      onboardingStore.setOnCompleteCallback(null);
    };
  }, [onboardingStore, onComplete]);

  if (onboardingStore.onboardingStep === OnboardingStepId.START) {
    return <Start dataReady={dataReady} />;
  }

  if (onboardingStore.onboardingStep === OnboardingStepId.LEARN_VOICE) {
    return <LearnVoice dataReady={dataReady} />;
  }

  if (onboardingStore.onboardingStep === OnboardingStepId.LEARN_TACTILE) {
    return <LearnTactile />;
  }

  return null;
};

export default observer(Onboarding);
