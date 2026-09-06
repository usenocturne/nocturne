import { View } from "../stores/ViewStore";
import type HardwareEvents from "../helpers/HardwareEvents";
import type { RootStore } from "../stores/RootStore";
import { action } from "mobx";

const reactToBackButton = (
  hardwareEvents: HardwareEvents,
  rootStore: RootStore,
) => {
  const {
    viewStore,
    npvStore,
    shelfStore,
    overlayController,
    settingsStore,
    onboardingStore,
    voiceStore,
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
    if (overlayController.isShowing("voice")) {
      voiceStore.cancel();
      return;
    }
    if (overlayController.isShowing("lets_drive")) {
      overlayController.hideLetsDrive();
      return;
    }
    if (overlayController.isSettingsShowing) {
      settingsStore.handleBack();
      return;
    }

    switch (viewStore.currentView) {
      case View.CONTENT_SHELF:
        if (shelfStore.shelfController) {
          shelfStore.shelfController.handleBackButton();
        }
        break;

      case View.NPV:
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
