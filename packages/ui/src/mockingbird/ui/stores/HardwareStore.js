import { makeAutoObservable } from 'mobx';

class HardwareStore {
  constructor(rootStore) {
    this.rootStore = rootStore;
    this.dialPressed = false;
    this.rebooting = false;
    this.ambientLightValue = 0;

    makeAutoObservable(this, {
      rootStore: false,
    });

    this._handleAmbientLight = (e) => {
      this.ambientLightValue = e.detail.value;
    };
    window.addEventListener('ambientLightUpdate', this._handleAmbientLight);
  }

  setDialPressed(dialPressed) {
    this.dialPressed = dialPressed;
  }

  setRebooting(rebooting) {
    this.rebooting = rebooting;
  }

  setAmbientLightValue(value) {
    this.ambientLightValue = value;
  }

  get isDialPressed() {
    return this.dialPressed;
  }

  get isRebooting() {
    return this.rebooting;
  }

  get currentAmbientLight() {
    return this.ambientLightValue;
  }

  async reboot() {
    this.setRebooting(true);
    try {
      const { sendNocturneWsRequest } = await import('../../../hooks/useNocturned');
      await sendNocturneWsRequest('device.power.reboot', {});
    } catch (e) {
      console.error('Reboot failed:', e);
      this.setRebooting(false);
    }
  }

  async factoryReset() {
    try {
      const { sendNocturneWsRequest } = await import('../../../hooks/useNocturned');
      await sendNocturneWsRequest('device.factoryreset', {});
      setTimeout(() => this.reboot(), 2000);
    } catch (e) {
      console.error('Factory reset failed:', e);
    }
  }

  async powerOff() {
    try {
      const { sendNocturneWsRequest } = await import('../../../hooks/useNocturned');
      await sendNocturneWsRequest('device.power.off', {});
    } catch (e) {
      console.error('Power off failed:', e);
    }
  }

  reset() {
    this.dialPressed = false;
    this.rebooting = false;
    this.ambientLightValue = 0;
  }
}

export default HardwareStore;
