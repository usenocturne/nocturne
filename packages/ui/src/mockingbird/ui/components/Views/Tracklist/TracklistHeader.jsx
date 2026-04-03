import { observer } from "mobx-react-lite";
import styles from "./TracklistHeader.module.scss";
import classNames from "classnames";
import { useCarThingStore } from "../../../contexts/CarThingStore";
import TracklistHeaderDetails from "./TracklistHeaderDetails";
import TracklistHeaderActions from "./TracklistHeaderActions";

const TracklistHeader = () => {
  const { tracklistStore } = useCarThingStore();
  const uiState = tracklistStore.tracklistUiState;

  return (
    <div className={styles.headerWrapper}>
      <div
        className={classNames(styles.header, {
          [styles.smallHeader]: uiState.smallHeader,
        })}
      >
        <TracklistHeaderDetails />
        {uiState.shouldShowHeart && <TracklistHeaderActions />}
      </div>
    </div>
  );
};

export default observer(TracklistHeader);
