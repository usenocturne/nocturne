import { observer } from "mobx-react-lite";
import { useEffect, useRef } from "react";
import { useCarThingStore } from "../../contexts/CarThingStore";
import { OnboardingStepId } from "../../stores/OnboardingStore";
import Start from "./Start";
import LearnVoice from "./LearnVoice";
import LearnTactile from "./LearnTactile";

const Onboarding = ({ onComplete, dataReady }) => {
  const { onboardingStore } = useCarThingStore();
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    onboardingStore.resetForNewOnboarding();
    onboardingStore.setOnCompleteCallback(() => {
      onCompleteRef.current?.();
    });
    onboardingStore.setOnboardingStarted(true);

    onboardingStore.launchApp();

    return () => {
      onboardingStore.setOnCompleteCallback(null);
    };
  }, [onboardingStore]);

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
