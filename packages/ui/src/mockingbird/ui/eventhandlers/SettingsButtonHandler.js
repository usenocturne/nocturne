import { action } from "mobx";

const reactToSettingsButton = (hardwareEvents, rootStore) => {
  const { overlayController, settingsStore } = rootStore;

  const handleSettings = action(() => {
    overlayController.toggleSettings();
  });

  const handleSettingsLongPress = action(() => {
    if (settingsStore) {
      settingsStore.handleSettingsButtonLongPress();
    }
  });

  hardwareEvents.onSettings(handleSettings);
  hardwareEvents.onSettingsLongPress(handleSettingsLongPress);
};

export default reactToSettingsButton;
