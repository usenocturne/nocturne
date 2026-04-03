import { useEffect, useRef, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { Transition } from 'react-transition-group';
import { reaction } from 'mobx';
import {
  MainMenuItemId,
  OptionsMenuItemId,
  AboutMenuItemId,
  RestartMenuItemId,
  AnimationType,
} from '../../stores/SettingsStore';
import styles from './Settings.module.scss';
import { useCarThingStore } from '../../contexts/CarThingStore';
import MainMenu from './MainMenu/MainMenu';
import Submenu from './Submenu/Submenu';
import FactoryReset from './FactoryReset/FactoryReset';
import RestartConfirm from './RestartConfirm/RestartConfirm';
import PowerTutorial from './PowerTutorial/PowerTutorial';
import Licenses from './Licenses/Licenses';
import TipsOnDemand from './TipsOnDemand/TipsOnDemand';
import DisplayAndBrightness from './DisplayAndBrightness/DisplayAndBrightness';
import PhoneCalls from './PhoneCalls/PhoneCalls';
import AirVentInterference from './AirVentInterference/AirVentInterference';
import PhoneConnection from './PhoneConnection/PhoneConnection';
import UnavailableSettingBanner from './UnavailableSettingBanner/UnavailableSettingBanner';
import classNames from 'classnames';
import variables from '../../styles/variables.module.scss';

const transitionDurationMs = parseInt(variables['transition-duration-ms'], 10) || 500;

const viewToComp = {
  [MainMenuItemId.SETTINGS_ROOT]: () => <MainMenu />,
  [OptionsMenuItemId.AIR_VENT_INTERFERENCE]: () => <AirVentInterference />,
  [OptionsMenuItemId.DISPLAY_AND_BRIGHTNESS]: () => <DisplayAndBrightness />,
  [MainMenuItemId.TIPS]: () => <TipsOnDemand />,
  [RestartMenuItemId.RESTART_CONFIRM]: () => <RestartConfirm />,
  [RestartMenuItemId.FACTORY_RESET]: () => <FactoryReset />,
  [RestartMenuItemId.POWER_OFF_TUTORIAL]: () => <PowerTutorial />,
  [MainMenuItemId.PHONE_CONNECTION]: () => <PhoneConnection />,
  [OptionsMenuItemId.PHONE_CALLS]: () => <PhoneCalls />,
  [AboutMenuItemId.LICENSE]: () => <Licenses />,
};

const getComponent = (view) => {
  if (view.id && viewToComp[view.id]) {
    return viewToComp[view.id]();
  }
  if (view.rows) {
    return <Submenu view={view} />;
  }
  return null;
};

const Settings = () => {
  const { settingsStore, overlayController } = useCarThingStore();
  const { viewStack } = settingsStore;
  const overlayRef = useRef(null);

  // Capture a DOM snapshot of the top view for exit animation
  const [exitingSnapshot, setExitingSnapshot] = useState(null);
  const [exitAnimType, setExitAnimType] = useState(null);
  const [enteringViewId, setEnteringViewId] = useState(null);
  const prevLenRef = useRef(viewStack.length);
  const topLayerRef = useRef(null);

  useEffect(() => {
    const disposer = reaction(
      () => settingsStore.viewStack.length,
      (newLen) => {
        const prevLen = prevLenRef.current;
        if (newLen > prevLen) {
          // Stack grew — animate the new top view in
          const newView = settingsStore.viewStack[newLen - 1];
          setEnteringViewId(newView.id);
          setTimeout(() => setEnteringViewId(null), transitionDurationMs);
        } else if (newLen < prevLen && topLayerRef.current) {
          // Stack shrank — capture the current top layer's DOM as a snapshot
          const el = topLayerRef.current;
          const clone = el.cloneNode(true);
          // Get the animation type of the view being popped
          // We stored it as a data attribute on the element
          const animType = el.dataset.animtype;
          setExitAnimType(animType === 'fade' ? 'fade' : 'slide');
          setExitingSnapshot(clone.innerHTML);
          setTimeout(() => {
            setExitingSnapshot(null);
            setExitAnimType(null);
          }, transitionDurationMs);
        }
        prevLenRef.current = newLen;
      },
    );
    return disposer;
  }, [settingsStore]);

  const currentView = viewStack[viewStack.length - 1];

  return (
    <Transition
      in={overlayController.isSettingsShowing}
      timeout={transitionDurationMs}
      unmountOnExit
      nodeRef={overlayRef}
    >
      {(overlayState) => (
        <div
          ref={overlayRef}
          className={classNames(styles.settingsOverlay, styles[`overlay_${overlayState}`])}
        >
          {/* Render each view in the stack as a layer */}
          {viewStack.map((view, index) => {
            const isTop = index === viewStack.length - 1;
            const isRoot = index === 0;
            const isFade = view.animationType === AnimationType.FADE_IN;
            const shouldAnimateIn = view.id === enteringViewId;

            return (
              <div
                key={view.id}
                ref={isTop ? topLayerRef : undefined}
                data-animtype={isFade ? 'fade' : 'slide'}
                className={classNames(styles.settingsLayer, {
                  [styles.transparent]: isFade,
                  [styles.slideUpIn]: shouldAnimateIn && !isFade,
                  [styles.fadeInAnim]: shouldAnimateIn && isFade,
                })}
                style={{ zIndex: index + 1 }}
              >
                {getComponent(view)}
              </div>
            );
          })}

          {/* Exiting snapshot — a DOM clone that animates out */}
          {exitingSnapshot && (
            <div
              className={classNames(styles.settingsLayer, {
                [styles.slideDownOut]: exitAnimType === 'slide',
                [styles.fadeOutAnim]: exitAnimType === 'fade',
              })}
              style={{ zIndex: viewStack.length + 10 }}
              dangerouslySetInnerHTML={{ __html: exitingSnapshot }}
            />
          )}

          <UnavailableSettingBanner />
        </div>
      )}
    </Transition>
  );
};

export default observer(Settings);
