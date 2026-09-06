import type { RootStore } from "./RootStore";
import type { InterappActions, MiddlewareActions } from "./StoreContracts";
import { makeAutoObservable } from "mobx";

class UbiLogger {
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  npvInteractionLogger = {
    logSwipeToNext: () => {},
    logSwipeToPrevious: () => {},
    logSwipeToShelf: () => {},
    logSwipeToQueue: () => {},
  };

  queueUbiLogger: QueueLogger = {};
  declare presetsUbiLogger: PresetLogger | undefined;
  declare trackListUbiLogger:
    | { logDialPressTrackRow?: (index: number, uri: string) => number | string }
    | undefined;

  contentShelfUbiLogger = {
    logImpression: () => console.log("Content shelf impression logged"),
  };

  constructor(
    interappActions: InterappActions,
    remoteConfigStore: RootStore["remoteConfigStore"],
    hardwareStore: RootStore["hardwareStore"],
  ) {
    makeAutoObservable(this);
  }

  clearQueue() {}
}

export default UbiLogger;

export interface QueueLogger {
  logTrackRowClicked?: (index: number, uri: string) => void;
  logDialPressTrackRow?: (index: number, uri: string) => void;
  logBackButtonPressed?: () => void;
  logImpression?: () => void;
}
export interface PresetLogger {
  logPresetButtonPressed?: (presetNumber: number) => void;
  logPresetButtonLongPressed?: (presetNumber: number) => void;
  logPresetCardTapped?: (presetNumber: number) => void;
  logImpression?: () => void;
}
