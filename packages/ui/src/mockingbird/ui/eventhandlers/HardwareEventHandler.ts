import type HardwareEvents from "../helpers/HardwareEvents";
import type { RootStore } from "../stores/RootStore";
import reactToDial from "./DialHandler";
import reactToBackButton from "./BackButtonHandler";
import reactToPresetButtons from "./PresetButtonHandler";
import reactToSettingsButton from "./SettingsButtonHandler";

const HardwareEventHandler = {
  handleEvents: (hardwareEvents: HardwareEvents, rootStore: RootStore) => {
    reactToDial(hardwareEvents, rootStore);
    reactToBackButton(hardwareEvents, rootStore);
    reactToPresetButtons(hardwareEvents, rootStore);
    reactToSettingsButton(hardwareEvents, rootStore);
  },
};

export default HardwareEventHandler;
