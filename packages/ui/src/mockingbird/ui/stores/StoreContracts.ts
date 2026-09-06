export interface InterappActions {
  getTts?: (fileName: string) => void;
}

export interface MiddlewareActions {
  onboardingGet?: () => void;
  onboardingFinished?: () => void;
  voiceMute?: (mute: boolean, force?: boolean) => void;
}

export interface MiddlewareMessage {
  type: string;
  payload?: { key?: string; value?: string };
}

export interface MiddlewareSocket {
  addSocketEventListener: (
    callback: (message: MiddlewareMessage) => void,
  ) => void;
}

export interface PersistentStorage {
  seeded?: boolean;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SharedPhoneDisplaySettings {
  phoneCallsEnabled?: boolean;
  notificationsEnabled?: boolean;
  locked?: boolean;
  lockedMessage?: string | null;
  updateSetting?: (
    key: "nativePhoneCallsEnabled" | "nativeNotificationsEnabled",
    value: boolean,
  ) => void;
}

export type OverlayController = {
  isSettingsShowing: boolean;
  currentOverlay: string | undefined;
  readonly anyOverlayIsShowing: boolean;
  readonly shouldShowNoContext: boolean;
  maybeShowAModal(): boolean;
  maybeShowNotSupportedType?: (show: boolean) => void;
  showModal?: (name: string) => void;
  resetAndMaybeShowAModal(): void;
  showPresets(): void;
  showSettings(): void;
  hideSettings(): void;
  showVoice(): void;
  hideVoice(): void;
  showLetsDrive(): void;
  hideLetsDrive(): void;
  maybeShowLetsDrive(): boolean;
  toggleSettings(): void;
  showStandby(): void;
  handleBackButton(): void;
  isShowing(name: string): boolean;
  readonly overlayUiState: {
    readonly currentOverlay: string | undefined;
    readonly isDismissible: boolean;
    maybeShowAModal(): boolean;
    handleBackdropOnClick(): void;
  };
  reset(): void;
};
