import { useState } from 'react';
import styles from './DisplayAndBrightness.module.scss';
import { observer } from 'mobx-react-lite';
import classNames from 'classnames';
import pointerListenersMaker from '../../../helpers/PointerListeners';
import { useCarThingStore } from '../../../contexts/CarThingStore';

const DisplayAndBrightness = () => {
  const [pressed, setPressed] = useState(false);
  const { nightModeController } = useCarThingStore();

  return (
    <>
      <div className={styles.header}>
        <span>Display and brightness</span>
      </div>
      <div className={styles.container}>
        <div
          className={classNames(styles.notification, {
            [styles.pressed]: pressed,
          })}
          {...pointerListenersMaker(setPressed)}
          onClick={() => nightModeController.toggleNightMode()}
        >
          <span className={styles.label}>Night mode</span>
          <span
            className={classNames(styles.value, {
              [styles.greenOn]: nightModeController.isNightMode,
            })}
          >
            {nightModeController.isNightMode ? 'On' : 'Off'}
          </span>
        </div>
        <div className={styles.text}>
          With night mode on, your screen should be easier to view in low-light
          conditions.
        </div>
      </div>
    </>
  );
};

export default observer(DisplayAndBrightness);
