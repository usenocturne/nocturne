import styles from "./VolumeConfirmation.module.scss";
import IconVolume48 from "../Icons/CarthingUIComponents/IconVolume48";
import IconVolumeOff48 from "../Icons/CarthingUIComponents/IconVolumeOff48";
import Type from "../CarthingUIComponents/Type/Type";

const clampPercent = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
};

const VolumeConfirmation = ({ volumeTarget }) => {
  const pct = clampPercent(volumeTarget);
  const Icon = pct > 0 ? IconVolume48 : IconVolumeOff48;

  return (
    <div className={styles.volume} data-testid="volume-confirmation">
      <div className={styles.volumeBar}>
        <span className={styles.volumeLevelFill} style={{ width: `${pct}%` }} />
      </div>
      <div className={styles.volumeInfo}>
        <div className={styles.volumeIcon}>
          <Icon />
        </div>
        <Type name="altoBold" textColor="white">
          {`Volume ${pct}`}
        </Type>
      </div>
    </div>
  );
};

export default VolumeConfirmation;
