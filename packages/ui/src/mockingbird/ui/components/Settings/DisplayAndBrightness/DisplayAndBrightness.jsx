import styles from "./DisplayAndBrightness.module.scss";

const DisplayAndBrightness = () => {
  return (
    <>
      <div className={styles.header}>
        <span>Display and brightness</span>
      </div>
      <div className={styles.container}>
        <div className={styles.notification}>
          <span className={styles.label}>Night mode</span>
          <span className={styles.comingSoon}>Coming in a future update</span>
        </div>
        <div className={styles.text}>
          With night mode on, your screen should be easier to view in low-light
          conditions.
        </div>
      </div>
    </>
  );
};

export default DisplayAndBrightness;
