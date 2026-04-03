import { observer } from "mobx-react-lite";
import { useCarThingStore } from "../../contexts/CarThingStore";
import { NoInteractionModalOption } from "../../stores/OnboardingStore";
import styles from "./NoInteractionModal.module.scss";

const NoInteractionModal = ({ visible }) => {
  const { onboardingStore } = useCarThingStore();

  const continueSelected =
    onboardingStore.noInteractionModal?.currentOption ===
    NoInteractionModalOption.CONTINUE;

  const handleContinue = () => {
    onboardingStore.continueOnboarding();
  };

  const handleEnd = () => {
    onboardingStore.endDuringTactile();
  };

  return (
    <div className={`${styles.noInteraction} ${visible ? styles.visible : ""}`}>
      <div className={styles.buttonGroup}>
        <button
          className={`${styles.button} ${continueSelected ? styles.primary : styles.secondary}`}
          onClick={handleContinue}
        >
          Continue Tour
        </button>
        <button
          className={`${styles.button} ${continueSelected ? styles.secondary : styles.primary}`}
          onClick={handleEnd}
        >
          End Tour
        </button>
      </div>
    </div>
  );
};

export default observer(NoInteractionModal);
