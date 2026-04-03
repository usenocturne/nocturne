import reactToDial from "./DialHandler";
import reactToBackButton from "./BackButtonHandler";
import reactToPresetButtons from "./PresetButtonHandler";
import reactToSettingsButton from "./SettingsButtonHandler";

const HardwareEventHandler = {
  handleEvents: (hardwareEvents, rootStore) => {
    reactToDial(hardwareEvents, rootStore);
    reactToBackButton(hardwareEvents, rootStore);
    reactToPresetButtons(hardwareEvents, rootStore);
    reactToSettingsButton(hardwareEvents, rootStore);
  },
};

export default HardwareEventHandler;
