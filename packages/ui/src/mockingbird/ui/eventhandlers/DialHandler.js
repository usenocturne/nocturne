import { action } from 'mobx';

export const isDialEnabled = (
  appView,
  isSettings,
  onboardingButtonEnabled,
  isPhoneCall,
) =>
  (appView === 'MAIN' && !isPhoneCall) ||
  isSettings ||
  (appView === 'ONBOARDING' && onboardingButtonEnabled);

const reactToDial = (hardwareEvents, rootStore) => {
  const {
    viewStore,
    npvStore,
    shelfStore,
    tracklistStore,
    queueStore,
    hardwareStore,
    ubiLogger,
    overlayController,
    settingsStore,
    onboardingStore,
  } = rootStore;

  const handleDialPress = action(() => {
    if (onboardingStore.isActive) {
      if (onboardingStore.dialPressEnabled || onboardingStore.noInteractionModal) {
        onboardingStore.handleDialPress();
      }
      if (!onboardingStore.dialPressEnabled) {
        return;
      }
      // Fall through to normal handling so the actual navigation occurs
    }
    if (overlayController.isSettingsShowing) {
      settingsStore.handleDialPress();
      return;
    }
    switch (viewStore.currentView) {
      case 'shelf':
        if (shelfStore.shelfController) {
          shelfStore.shelfController.handleDialPress();
        }
        break;

      case 'tracklist':
        if (tracklistStore.tracklistUiState.selectedItem) {
          const id = ubiLogger && ubiLogger.trackListUbiLogger && ubiLogger.trackListUbiLogger.logDialPressTrackRow
            ? ubiLogger.trackListUbiLogger.logDialPressTrackRow(
              tracklistStore.tracklistUiState.selectedItemIndex,
              tracklistStore.tracklistUiState.selectedItem.uri,
            )
            : Date.now();
          tracklistStore.tracklistUiState.handleItemSelected(
            tracklistStore.tracklistUiState.selectedItem,
            id,
          );
        }
        break;

      case 'npv':
        if (npvStore.npvController) {
          npvStore.npvController.handleDialPress();
        }
        break;
      
      case 'queue':
        if (queueStore.queueUiState) {
          queueStore.queueUiState.handleDialPress();
        }
        break;

      default:
        break;
    }
  });

  const handleDialLongPress = action(() => {
    switch (viewStore.currentView) {
      case 'npv':
        if (npvStore.npvController) {
          npvStore.npvController.handleDialLongPress();
        }
        break;

      default:
        break;
    }
  });

  const handleDialDown = action(() => {
    hardwareStore.setDialPressed(true);
  });

  const handleDialUp = action(() => {
    hardwareStore.setDialPressed(false);
  });

  const handleDialLeft = action(() => {
    if (onboardingStore.isActive) {
      if (onboardingStore.dialTurnEnabled || onboardingStore.noInteractionModal) {
        onboardingStore.handleDialTurn();
      }
      if (!onboardingStore.dialTurnEnabled) {
        return;
      }
      // Fall through to normal handling so the shelf scrolls
    }
    if (overlayController.isSettingsShowing) {
      settingsStore.handleDialLeft();
      return;
    }
    switch (viewStore.currentView) {
      case 'shelf':
        if (shelfStore.shelfController) {
          shelfStore.shelfController.handleDialLeft();
        }
        break;

      case 'tracklist':
        if (tracklistStore.tracklistUiState.leftItem &&
          tracklistStore.tracklistUiState.leftItem !== tracklistStore.tracklistUiState.selectedItem) {
          tracklistStore.tracklistUiState.updateSelectedItem(
            tracklistStore.tracklistUiState.leftItem,
            true
          );
        }
        break;

      case 'npv':
        if (npvStore.npvController) {
          npvStore.npvController.handleDialLeft();
        }
        break;
      
      case 'queue':
        if (queueStore.queueUiState) {
          queueStore.queueUiState.handleDialLeft();
        }
        break;

      default:
        break;
    }
  });

  const handleDialRight = action(() => {
    if (onboardingStore.isActive) {
      if (onboardingStore.dialTurnEnabled || onboardingStore.noInteractionModal) {
        onboardingStore.handleDialTurn();
      }
      if (!onboardingStore.dialTurnEnabled) {
        return;
      }
      // Fall through to normal handling so the shelf scrolls
    }
    if (overlayController.isSettingsShowing) {
      settingsStore.handleDialRight();
      return;
    }
    switch (viewStore.currentView) {
      case 'shelf':
        if (shelfStore.shelfController) {
          shelfStore.shelfController.handleDialRight();
        }
        break;

      case 'tracklist':
        if (tracklistStore.tracklistUiState.rightItem &&
          tracklistStore.tracklistUiState.rightItem !== tracklistStore.tracklistUiState.selectedItem) {
          tracklistStore.tracklistUiState.updateSelectedItem(
            tracklistStore.tracklistUiState.rightItem,
            true
          );
        }
        break;

      case 'npv':
        if (npvStore.npvController) {
          npvStore.npvController.handleDialRight();
        }
        break;
      
      case 'queue':
        if (queueStore.queueUiState) {
          queueStore.queueUiState.handleDialRight();
        }
        break;

      default:
        break;
    }
  });

  hardwareEvents.onDialPress(handleDialPress);
  hardwareEvents.onDialLongPress(handleDialLongPress);
  hardwareEvents.onDialButtonDown(handleDialDown);
  hardwareEvents.onDialButtonUp(handleDialUp);
  hardwareEvents.onDialLeft(handleDialLeft);
  hardwareEvents.onDialRight(handleDialRight);
};

export default reactToDial;