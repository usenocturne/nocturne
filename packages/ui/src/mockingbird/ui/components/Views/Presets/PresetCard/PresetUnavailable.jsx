import { observer } from "mobx-react-lite";
import LazyImage from "../../Npv/PlayingInfo/LazyImage/LazyImage";
import styles from "./PresetUnavailable.module.scss";
import Type from "../../../CarthingUIComponents/Type/Type";
import { useCarThingStore } from "../../../../contexts/CarThingStore";
import classNames from "classnames";

const PresetUnavailable = ({ preset }) => {
  const { presetsController } = useCarThingStore();
  const uiState = presetsController.presetsUiState;
  const isFocused = uiState.selectedPresetNumber === preset.slot_index;

  const getPresetCategoryType = (uri) => {
    if (uri.includes("spotify:playlist:")) return "Playlist";
    if (uri.includes("spotify:album:")) return "Album";
    if (uri.includes("spotify:artist:")) return "Artist";
    if (uri.includes("spotify:station:")) return "Radio Station";
    if (uri.includes("spotify:show:")) return "Podcast";
    return "Content";
  };

  return (
    <>
      <LazyImage
        size={168}
        scale={3}
        uri={preset.context_uri}
        isActive={isFocused}
      />
      <div className={styles.presetUnavailableTitles}>
        <Type
          name="mestroBold"
          className={classNames(styles.title, {
            [styles.active]: isFocused,
          })}
        >
          {getPresetCategoryType(preset.context_uri)}
        </Type>
        <Type name="mestroBold" className={styles.unavailable}>
          unavailable
        </Type>
      </div>
    </>
  );
};

export default observer(PresetUnavailable);
