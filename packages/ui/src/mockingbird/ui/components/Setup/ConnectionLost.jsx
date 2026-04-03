import styles from "./ConnectionLost.module.scss";

const ConnectionLost = () => {
  return (
    <div className={styles.screen}>
      <div className={styles.title}>Connection lost</div>
      <div className={styles.subtitle}>
        Make sure your phone is turned on, Bluetooth is on, and your phone is in
        range of Car Thing.
      </div>
    </div>
  );
};

export default ConnectionLost;
