import type { TracklistItem } from "../../../stores/TracklistModels";
import { observer } from "mobx-react-lite";
import styles from "./ProgressBar.module.scss";

const ProgressBar = ({
  item,
  isCurrent,
}: {
  item: TracklistItem;
  isCurrent?: boolean;
}) => {
  const { uri, metadata } = item;

  if (isCurrent && metadata && metadata.progress_percentage !== undefined) {
    return (
      <div data-testid={`progress-bar-${uri}`} className={styles.progressBar}>
        <div
          className={styles.progress}
          style={{ width: `${metadata.progress_percentage}%` }}
        />
      </div>
    );
  }

  if (metadata && metadata.progress_percentage !== undefined) {
    return (
      <div data-testid={`progress-bar-${uri}`} className={styles.progressBar}>
        <div
          className={styles.progress}
          style={{ width: `${metadata.progress_percentage}%` }}
        />
      </div>
    );
  }

  return null;
};

export default observer(ProgressBar);
