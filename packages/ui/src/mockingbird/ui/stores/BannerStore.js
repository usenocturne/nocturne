import { makeAutoObservable } from 'mobx';

class BannerStore {
  _showNoNetwork = false;

  constructor(rootStore) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });

    this._handleNetworkShow = () => { this._showNoNetwork = true; };
    this._handleNetworkHide = () => { this._showNoNetwork = false; };
    window.addEventListener('networkBannerShow', this._handleNetworkShow);
    window.addEventListener('networkBannerHide', this._handleNetworkHide);
  }

  get shouldShowWindAlertBanner() {
    return false;
  }

  get shouldShowNoNetworkBanner() {
    return this._showNoNetwork;
  }
}

export default BannerStore;
