import { action } from "mobx";

const reactToPresetButtons = (hardwareEvents, rootStore) => {
  const { presetsController, settingsStore } = rootStore;

  const handlePresetButtonPress = (presetNumber) => {
    if (!presetsController.isPresetButtonsEnabled) {
      return;
    }

    settingsStore?.handlePresetButtonPressed?.();
    presetsController.presetsUiState.handlePresetButtonPress(presetNumber);
  };

  const handlePresetButtonLongPress = (presetNumber) => {
    if (!presetsController.isPresetButtonsEnabled) {
      return;
    }

    presetsController.presetsUiState.handlePresetButtonLongPress(presetNumber);
  };

  const handlePreset1 = action(() => {
    handlePresetButtonPress(1);
  });

  const handlePreset1LongPress = action(() => {
    handlePresetButtonLongPress(1);
  });

  const handlePreset2 = action(() => {
    handlePresetButtonPress(2);
  });

  const handlePreset2LongPress = action(() => {
    handlePresetButtonLongPress(2);
  });

  const handlePreset3 = action(() => {
    handlePresetButtonPress(3);
  });

  const handlePreset3LongPress = action(() => {
    handlePresetButtonLongPress(3);
  });

  const handlePreset4 = action(() => {
    handlePresetButtonPress(4);
  });

  const handlePreset4LongPress = action(() => {
    handlePresetButtonLongPress(4);
  });

  hardwareEvents.onPreset1(handlePreset1);
  hardwareEvents.onPreset1LongPress(handlePreset1LongPress);
  hardwareEvents.onPreset2(handlePreset2);
  hardwareEvents.onPreset2LongPress(handlePreset2LongPress);
  hardwareEvents.onPreset3(handlePreset3);
  hardwareEvents.onPreset3LongPress(handlePreset3LongPress);
  hardwareEvents.onPreset4(handlePreset4);
  hardwareEvents.onPreset4LongPress(handlePreset4LongPress);
};

export default reactToPresetButtons;
