import { action } from "mobx";

const reactToBackButton = (hardwareEvents, rootStore) => {
  const {
    viewStore,
    npvStore,
    shelfStore,
    overlayController,
    settingsStore,
    onboardingStore,
  } = rootStore;

  const handleBackButton = action(() => {
    if (onboardingStore.isActive) {
      if (onboardingStore.backEnabled || onboardingStore.noInteractionModal) {
        onboardingStore.handleBack();
      }
      if (!onboardingStore.backEnabled) {
        return;
      }
    }
    if (overlayController.isSettingsShowing) {
      settingsStore.handleBack();
      return;
    }

    switch (viewStore.currentView) {
      case "CONTENT_SHELF":
        if (shelfStore.shelfController) {
          shelfStore.shelfController.handleBackButton();
        }
        break;

      case "NPV":
        if (npvStore.npvController) {
          npvStore.npvController.handleBackButton();
        } else {
          viewStore.back();
        }
        break;

      default:
        viewStore.back();
        break;
    }
  });

  hardwareEvents.onBack(handleBackButton);
};

export default reactToBackButton;
