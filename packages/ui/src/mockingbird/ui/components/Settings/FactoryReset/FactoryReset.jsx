import { useCarThingStore } from '../../../contexts/CarThingStore';
import { useEffect } from 'react';
import styles from './FactoryReset.module.scss';
import { observer } from 'mobx-react-lite';
import classNames from 'classnames';

const FactoryReset = () => {
  const { hardwareStore, settingsStore } = useCarThingStore();

  useEffect(() => {
    settingsStore.setFactoryResetConfirmationIsActive(true);
  }, [settingsStore]);

  const factoryReset = () => {
    hardwareStore.factoryReset();
  };

  return (
    <div className={styles.factoryReset}>
      <div className={styles.description}>
        Are you really sure you want to do a factory reset? All data on this
        device will be erased. This cannot be undone.
      </div>
      <div className={styles.buttons}>
        <button
          className={classNames(styles.button, {
            [styles.primary]: settingsStore.factoryResetConfirmationIsActive,
            [styles.secondary]: !settingsStore.factoryResetConfirmationIsActive,
          })}
          onClick={factoryReset}
        >
          Delete all
        </button>
        <button
          className={classNames(styles.button, {
            [styles.primary]: !settingsStore.factoryResetConfirmationIsActive,
            [styles.secondary]: settingsStore.factoryResetConfirmationIsActive,
          })}
          onClick={() => settingsStore.handleFactoryResetClicked()}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default observer(FactoryReset);
