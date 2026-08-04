import { makeAutoObservable } from "mobx";

class UbiLogger {
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  npvInteractionLogger = {
    logSwipeToNext: () => {},
    logSwipeToPrevious: () => {},
    logSwipeToShelf: () => {},
    logSwipeToQueue: () => {},
  };

  queueUbiLogger = {};

  contentShelfUbiLogger = {
    logImpression: () => console.log("Content shelf impression logged"),
  };

  constructor(rootStore: UiLooseData) {
    this.rootStore = rootStore;
    makeAutoObservable(this);
  }
}

export default UbiLogger;
