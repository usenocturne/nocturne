import { makeAutoObservable } from 'mobx';

class VoiceStore {
  constructor(rootStore) {
    this.rootStore = rootStore;
    makeAutoObservable(this);
  }
}

export default VoiceStore;