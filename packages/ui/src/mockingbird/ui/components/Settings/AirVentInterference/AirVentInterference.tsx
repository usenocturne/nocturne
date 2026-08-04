import { useEffect, useRef, useState } from "react";
import classNames from "classnames";
import { observer } from "mobx-react-lite";
import { useCarThingStore } from "../../../contexts/CarThingStore";
import pointerListenersMaker from "../../../helpers/PointerListeners";
import { IconWind32 } from "../../Icons/CarthingUIComponents";
import styles from "./AirVentInterference.module.scss";

const CONTENT_HEIGHT = 490;
const NUMBER_OF_SCROLL_STEPS = 3;
const SCROLL_STEP_SIZE = CONTENT_HEIGHT / NUMBER_OF_SCROLL_STEPS;

const AirVentInterference = () => {
  const [pressed, setPressed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const uiState =
    useCarThingStore().airVentInterferenceController.airVentInterferenceUiState;

  useEffect(() => {
    const scrollElement = containerRef.current;
    if (!scrollElement) return;

    const updateScrollStep = () => {
      const hitBottom =
        scrollElement.scrollTop ===
        scrollElement.scrollHeight - scrollElement.offsetHeight;
      if (hitBottom) {
        uiState.setAirVentInterferenceScrollStep(
          (scrollElement.scrollTop / CONTENT_HEIGHT) * NUMBER_OF_SCROLL_STEPS,
        );
      }
    };
    const updateTouchStep = () => {
      uiState.setAirVentInterferenceScrollStep(
        (scrollElement.scrollTop / CONTENT_HEIGHT) * NUMBER_OF_SCROLL_STEPS,
      );
    };

    scrollElement.addEventListener("touchend", updateTouchStep);
    scrollElement.addEventListener("scroll", updateScrollStep);
    return () => {
      scrollElement.removeEventListener("touchend", updateTouchStep);
      scrollElement.removeEventListener("scroll", updateScrollStep);
      uiState.resetAirVentContainerScrollStep();
    };
  }, [uiState]);

  useEffect(() => {
    const scrollElement = containerRef.current;
    if (!scrollElement) return;
    scrollElement.scrollTo({
      top: uiState.airVentContainerScrollStep * SCROLL_STEP_SIZE,
      behavior: "smooth",
    });
  }, [uiState, uiState.airVentContainerScrollStep]);

  return (
    <>
      <div className={styles.aviHeader}>
        <span>Air vent interference</span>
      </div>
      <div ref={containerRef} className={styles.aviContainer}>
        <div
          className={classNames(styles.notification, {
            [styles.pressed]: pressed || uiState.highlightOption,
            [styles.focused]: uiState.isNotificationStep,
          })}
          {...pointerListenersMaker(setPressed)}
          onClick={() => uiState.toggleNotification()}
          data-testid="avi-notification"
        >
          <p>Allow air vent alerts</p>
          <span
            data-testid="avi-notification-status"
            className={classNames({
              [styles.onOff]: !uiState.airVentAlertsDisabled,
            })}
          >
            {uiState.airVentAlertsDisabled ? "Off" : "On"}
          </span>
        </div>
        <div className={styles.texts}>
          <p className={styles.intro}>
            Too much air flowing into your microphones will likely interfere
            with voice requests. When we detect an issue, <IconWind32 /> will
            appear at the top right corner of the screen. If this happens, here
            are some things to try:
          </p>
          <ul>
            <li>Move Car Thing above the level of air flow</li>
            <li>Direct the air flow below Car Thing</li>
            <li>Close the air vent</li>
            <li>Use a different mount</li>
          </ul>
        </div>
      </div>
    </>
  );
};

export default observer(AirVentInterference);
