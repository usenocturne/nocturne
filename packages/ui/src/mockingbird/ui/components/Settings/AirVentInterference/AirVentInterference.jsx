import { useState } from "react";
import styles from "./AirVentInterference.module.scss";
import { observer } from "mobx-react-lite";
import classNames from "classnames";
import pointerListenersMaker from "../../../helpers/PointerListeners";
import { useCarThingStore } from "../../../contexts/CarThingStore";

const AirVentInterference = () => {
  const [pressed, setPressed] = useState(false);
  const { airVentInterferenceController } = useCarThingStore();

  return (
    <>
      <div className={styles.aviHeader}>
        <span>Air vent interference</span>
      </div>
      <div className={styles.aviContainer}>
        <div
          className={classNames(styles.notification, {
            [styles.pressed]: pressed,
          })}
          {...pointerListenersMaker(setPressed)}
          onClick={() => airVentInterferenceController.toggleAlertDisabled()}
        >
          <p>Allow air vent alerts</p>
          <span
            className={classNames({
              [styles.onOff]: !airVentInterferenceController.alertDisabled,
            })}
          >
            {airVentInterferenceController.alertDisabled ? "Off" : "On"}
          </span>
        </div>
        <div className={styles.texts}>
          <p className={styles.intro}>
            Too much air flowing into your microphones will likely interfere
            with voice requests. When we detect an issue, a wind icon will
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
