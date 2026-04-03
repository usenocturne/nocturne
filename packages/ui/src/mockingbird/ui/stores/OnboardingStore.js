import { makeAutoObservable } from 'mobx';
import { sendNocturneWsRequest } from '../../../hooks/useNocturned';

export const OnboardingStepId = {
  START: 0,
  LEARN_VOICE: 1,
  LEARN_TACTILE: 2,
};

export const LearnVoiceStepId = {
  FIRST_UP: 0,
  VOICE_PLAY_DRIVING_MUSIC: 1,
  VOICE_NEXT_SONG: 2,
  LAST_STEP: 3,
};

export const NoInteractionModalOption = {
  CONTINUE: 'CONTINUE',
  END: 'END',
};

export const delayedAction = (actionToRun, timeout) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      actionToRun();
      resolve();
    }, timeout);
  });
};

// TTS file definitions with durations (matching original superbird-webapp)
const TTS = {
  START: { fileName: 'onboarding_start', fileLength: 3000 },
  VOICE_1_1: { fileName: 'onboarding_learn_voice_1_1', fileLength: 5000 },
  VOICE_2_1: { fileName: 'onboarding_learn_voice_2_1', fileLength: 3600 },
  VOICE_2_2: { fileName: 'onboarding_learn_voice_2_2', fileLength: 6000 },
  VOICE_3_1: { fileName: 'onboarding_learn_voice_3_1', fileLength: 6000 },
  VOICE_3_2: { fileName: 'onboarding_learn_voice_3_2', fileLength: 5000 },
  TACTILE_NAVIGATION: { fileName: 'onboarding_learn_tactile_navigation', fileLength: 8000 },
  SHELF_EXPLAIN: { fileName: 'onboarding_learn_tactile_shelf_explain', fileLength: 7000 },
  SHELF_DIAL_TURN: { fileName: 'onboarding_learn_tactile_shelf_dial_turn', fileLength: 2000 },
  SHELF_DIAL_PRESS: { fileName: 'onboarding_learn_tactile_shelf_dial_press', fileLength: 4000 },
  TRACKLIST_DIAL_PRESS: { fileName: 'onboarding_learn_tactile_tracklist_dial_press', fileLength: 2000 },
  NPV_EXPLAIN: { fileName: 'onboarding_learn_tactile_npv_explain', fileLength: 4000 },
  NPV_DIAL_PRESS: { fileName: 'onboarding_learn_tactile_npv_dial_press', fileLength: 4000 },
  NPV_BACK_PRESS: { fileName: 'onboarding_learn_tactile_npv_back_press', fileLength: 6000 },
  TRACKLIST_BACK_PRESS: { fileName: 'onboarding_learn_tactile_tracklist_back_press', fileLength: 3000 },
  SHELF_BACK_PRESS: { fileName: 'onboarding_learn_tactile_shelf_back_press', fileLength: 6000 },
  END_TOUR: { fileName: 'onboarding_learn_tactile_end_tour', fileLength: 5000 },
  END_TOUR_VIA_SKIP: { fileName: 'onboarding_learn_tactile_end_tour_via_skip', fileLength: 5000 },
};

class OnboardingStore {
  constructor(rootStore, socket, interappActions, middlewareActions) {
    makeAutoObservable(this, {
      rootStore: false,
      interappActions: false,
      middlewareActions: false,
      _onCompleteCallback: false,
    });

    this.rootStore = rootStore;
    this.interappActions = interappActions;
    this.middlewareActions = middlewareActions;

    if (socket?.addSocketEventListener) {
      socket.addSocketEventListener((msg) => this.onMiddlewareEvent(msg));
    }
  }

  onboardingMsgReceived = false;
  onboardingFinished = false;
  onboardingStarted = false;
  onboardingStep = OnboardingStepId.START;
  dialPressEnabled = false;
  dialTurnEnabled = false;
  backEnabled = false;
  dialTurnCounter = 0;
  dialPressCounter = 0;
  backCounter = 0;
  noInteractionModal = undefined;
  learnVoiceStep = LearnVoiceStepId.FIRST_UP;
  _onCompleteCallback = null;

  onMiddlewareEvent(msg) {
    if (
      msg.type === 'settings_response' &&
      msg.payload.key === 'onboarding_status'
    ) {
      this.onboardingMsgReceived = true;
      if (msg.payload.value) {
        this.onboardingFinished = msg.payload.value === 'finished';
      }
    }
  }

  get shouldShowOnboarding() {
    return (
      !this.onboardingFinished ||
      (this.onboardingFinished && this.onboardingStarted)
    );
  }

  get isActive() {
    return this.onboardingStarted && !this.onboardingFinished;
  }

  setOnCompleteCallback(callback) {
    this._onCompleteCallback = callback;
  }

  setOnboardingStarted(started) {
    this.onboardingStarted = started;
  }

  setOnboardingView(onboardingStep) {
    this.onboardingStep = onboardingStep;
  }

  // --- TTS methods ---

  playTts(fileName) {
    sendNocturneWsRequest('tts.speak', { file: fileName }).catch((e) => {
      console.warn('[OnboardingStore] TTS failed:', fileName, e);
    });
  }

  waitForTts(tts) {
    this.playTts(tts.fileName);
    return new Promise((resolve) => {
      setTimeout(resolve, tts.fileLength + 1000);
    });
  }

  launchApp() {
    sendNocturneWsRequest('device.launchApp', {
      bundleId: 'com.usenocturne.nocturne',
    }).catch((e) => {
      console.warn('[OnboardingStore] launchApp failed:', e);
    });
  }

  // --- No interaction modal ---

  showNoInteractionModal() {
    this.noInteractionModal = {
      tactileEnabledOnClose: {
        back: this.backEnabled,
        turn: this.dialTurnEnabled,
        press: this.dialPressEnabled,
      },
      currentOption: NoInteractionModalOption.CONTINUE,
    };
    this.setDialPressEnabled(false);
    this.setDialTurnEnabled(false);
    this.setBackEnabled(false);
  }

  hideNoInteractionModal() {
    if (this.noInteractionModal) {
      this.setBackEnabled(this.noInteractionModal.tactileEnabledOnClose.back);
      this.setDialPressEnabled(
        this.noInteractionModal.tactileEnabledOnClose.press,
      );
      this.setDialTurnEnabled(
        this.noInteractionModal.tactileEnabledOnClose.turn,
      );
      this.noInteractionModal = undefined;
    }
  }

  endDuringTactile() {
    this.hideNoInteractionModal();
    this.setOnboardingFinished();
  }

  continueOnboarding() {
    this.hideNoInteractionModal();
  }

  setOnboardingFinished() {
    this.onboardingFinished = true;
    this.setOnboardingStarted(false);
    if (this._onCompleteCallback) {
      this._onCompleteCallback();
    }
  }

  waitForDelay(delayMs) {
    return new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  setDialPressEnabled(dialPressed) {
    this.dialPressEnabled = dialPressed;
  }

  setDialTurnEnabled(dialTurned) {
    this.dialTurnEnabled = dialTurned;
  }

  setBackEnabled(backPressed) {
    this.backEnabled = backPressed;
  }

  handleDialTurn() {
    if (this.noInteractionModal) {
      this.noInteractionModal.currentOption =
        this.noInteractionModal.currentOption ===
          NoInteractionModalOption.CONTINUE
          ? NoInteractionModalOption.END
          : NoInteractionModalOption.CONTINUE;
    } else if (this.dialTurnEnabled) {
      this.dialTurnCounter++;
    }
  }

  handleDialPress() {
    if (this.noInteractionModal) {
      switch (this.noInteractionModal.currentOption) {
        case NoInteractionModalOption.CONTINUE:
          this.continueOnboarding();
          break;
        case NoInteractionModalOption.END:
          this.endDuringTactile();
          break;
        default:
          break;
      }
    } else if (this.dialPressEnabled) {
      this.dialPressCounter++;
    }
  }

  handleBack() {
    if (this.noInteractionModal) {
      this.hideNoInteractionModal();
    } else if (this.backEnabled) {
      this.backCounter++;
    }
  }

  get isOnboardingOngoing() {
    return this.onboardingStarted && !this.onboardingFinished;
  }

  setLearnVoiceStep(step) {
    this.learnVoiceStep = step;
  }

  nextLearnVoiceStep() {
    if (this.learnVoiceStep >= LearnVoiceStepId.LAST_STEP) {
      this.setOnboardingView(OnboardingStepId.LEARN_TACTILE);
    } else {
      this.learnVoiceStep++;
    }
  }

  handleStartClick = () => {
    this.setOnboardingView(OnboardingStepId.LEARN_VOICE);
  };

  resetForNewOnboarding() {
    this.onboardingStep = OnboardingStepId.START;
    this.onboardingFinished = false;
    this.onboardingStarted = false;
    this.dialPressEnabled = false;
    this.dialTurnEnabled = false;
    this.backEnabled = false;
    this.dialTurnCounter = 0;
    this.dialPressCounter = 0;
    this.backCounter = 0;
    this.noInteractionModal = undefined;
    this.learnVoiceStep = LearnVoiceStepId.FIRST_UP;
  }
}

export { TTS };
export default OnboardingStore;
