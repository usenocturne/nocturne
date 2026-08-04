import { makeAutoObservable } from "mobx";

class BannerStore {
  declare _handleNetworkHide: UiLooseData;
  declare _handleNetworkShow: UiLooseData;
  declare rootStore: UiLooseData;
  declare interappActions: UiLooseData;
  declare middlewareActions: UiLooseData;
  _showNoNetwork = false;

  constructor(rootStore: UiLooseData) {
    this.rootStore = rootStore;
    makeAutoObservable(this, { rootStore: false });

    this._handleNetworkShow = () => {
      this._showNoNetwork = true;
    };
    this._handleNetworkHide = () => {
      this._showNoNetwork = false;
    };
    window.addEventListener("networkBannerShow", this._handleNetworkShow);
    window.addEventListener("networkBannerHide", this._handleNetworkHide);
  }

  get shouldShowWindAlertBanner() {
    return this.rootStore.airVentInterferenceController.windAlertBannerUiState
      .shouldShowAlert;
  }

  get shouldShowNoNetworkBanner() {
    return this._showNoNetwork;
  }
}

export default BannerStore;
