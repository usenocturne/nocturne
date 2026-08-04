import { observer } from "mobx-react-lite";
import { useCarThingStore } from "../../../../contexts/CarThingStore";
import LazyImage from "../PlayingInfo/LazyImage/LazyImage";
import StatusIcons from "../PlayingInfo/StatusIcons";
import styles from "./OtherMedia.module.scss";

const OtherMedia = () => {
  const { playerStore, npvStore, spotifyControls } = useCarThingStore();
  const app = playerStore.otherActiveApp;
  const playingInfo = npvStore.playingInfoUiState;

  const title = playingInfo.title || "";
  const subtitle = playingInfo.subtitle || "";
  const imageId = playingInfo.currentItem?.image_uri || "";

  const handleArtworkClick = () => {
    const isPlaying = npvStore.controlButtonsUiState.isPlaying;
    if (playerStore.isOtherMediaPlaying) {
      if (isPlaying) {
        spotifyControls?.phoneMediaPause?.();
      } else {
        spotifyControls?.phoneMediaPlay?.();
      }
    } else {
      if (isPlaying) {
        spotifyControls?.pausePlayback?.();
      } else {
        spotifyControls?.playTrack?.();
      }
    }
  };

  return (
    <div className={styles.otherMedia}>
      <div className={styles.topBar}>
        <StatusIcons />
      </div>
      <div className={styles.widget}>
        <div className={styles.artwork} onClick={handleArtworkClick}>
          <LazyImage
            size={224}
            imageId={imageId}
            uri={playingInfo.currentItem?.uri || ""}
          />
        </div>
        <div className={styles.metadata}>
          {app && <div className={styles.source}>Playing on {app}</div>}
          <div className={styles.title}>{title}</div>
          <div className={styles.subtitle}>{subtitle}</div>
        </div>
      </div>
    </div>
  );
};

export default observer(OtherMedia);
