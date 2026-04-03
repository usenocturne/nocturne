import { useCarThingStore } from '../../../contexts/CarThingStore';
import styles from './RestartConfirm.module.scss';

const RestartConfirm = () => {
  const { hardwareStore } = useCarThingStore();

  const reboot = () => {
    hardwareStore.reboot();
  };

  return (
    <div className={styles.restartConfirm}>
      <div className={styles.title}>Are you sure?</div>
      <div className={styles.description}>
        Tap the button to restart Car Thing.
      </div>
      <button className={styles.button} onClick={reboot}>
        Restart Car Thing
      </button>
    </div>
  );
};

export default RestartConfirm;
