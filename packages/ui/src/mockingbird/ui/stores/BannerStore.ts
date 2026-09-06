import type { RootStore } from "./RootStore";
import type { InterappActions, MiddlewareActions } from "./StoreContracts";
import { makeAutoObservable } from "mobx";

class BannerStore {
  declare _handleNetworkHide: () => void;
  declare _handleNetworkShow: () => void;
  declare rootStore: RootStore;
  declare interappActions: InterappActions;
  declare middlewareActions: MiddlewareActions;
  _showNoNetwork = false;

  constructor(rootStore: RootStore) {
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
