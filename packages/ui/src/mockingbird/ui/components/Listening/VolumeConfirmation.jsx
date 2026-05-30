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
      <Icon className={styles.confirmationIcon} />
      <Type
        name="altoBold"
        textColor="white"
        className={styles.confirmationText}
      >
        {`Volume ${pct}`}
      </Type>
    </div>
  );
};

export default VolumeConfirmation;
