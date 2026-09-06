import type HardwareEvents from "../helpers/HardwareEvents";
import type { RootStore } from "../stores/RootStore";
import { action } from "mobx";

const reactToSettingsButton = (
  hardwareEvents: HardwareEvents,
  rootStore: RootStore,
) => {
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
