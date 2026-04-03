import { makeAutoObservable } from "mobx";

class UbiLogger {
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

  constructor(rootStore) {
    this.rootStore = rootStore;
    makeAutoObservable(this);
  }
}

export default UbiLogger;
