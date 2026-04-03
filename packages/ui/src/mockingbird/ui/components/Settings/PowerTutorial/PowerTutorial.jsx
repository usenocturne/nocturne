import styles from './PowerTutorial.module.scss';

const PowerTutorial = () => {
  return (
    <div className={styles.powerTutorial}>
      <div className={styles.title}>Power off/on</div>
      <div className={styles.description}>
        To power off/on, press and hold the Settings button on top of your
        device.
      </div>
    </div>
  );
};

export default PowerTutorial;
