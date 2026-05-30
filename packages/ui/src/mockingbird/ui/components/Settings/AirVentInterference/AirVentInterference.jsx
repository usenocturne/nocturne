import styles from "./AirVentInterference.module.scss";

const AirVentInterference = () => {
  return (
    <>
      <div className={styles.aviHeader}>
        <span>Air vent interference</span>
      </div>
      <div className={styles.aviContainer}>
        <div className={styles.notification}>
          <p>Allow air vent alerts</p>
          <span className={styles.comingSoon}>Coming in a future update</span>
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

export default AirVentInterference;
