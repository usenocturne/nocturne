import classNames from "classnames";
import { useCarThingStore } from "../../../../contexts/CarThingStore";
import Type from "../../../CarthingUIComponents/Type/Type";
import styles from "./ShelfSwiperItem.module.scss";

export const TITLES = {
  playlists: "You don't have any playlists",
  podcasts: "You haven't followed any podcasts",
  artists: "You haven't followed any artists",
  albums: "You haven't saved any albums",
  voice: "No voice results",
};

const VOICE_TIPS = {
  playlists: '"Hey Spotify, like this playlist" or tap the heart icon.',
  podcasts: '"Hey Spotify, follow this podcast" or tap the heart icon.',
  artists: '"Hey Spotify, follow this artist" or tap the heart icon.',
  albums: '"Hey Spotify, like this album" or tap the heart icon.',
  voice: 'Tap the mic button or say "Hey Spotify".',
};

const InlineTipItem = ({ item, isActive }) => {
  const { shelfStore } = useCarThingStore();
  const uiState = shelfStore.shelfController.shelfSwiperItemUiState;
  const categoryTitle = uiState.getcategoryItemTitle(item.category);

  const isHidden = uiState.isHidden(item);
  const isLeft = uiState.isLeftItem(item);
  const isVoiceTip = uiState.isVoiceTextPlaceholder(item);
  const title = TITLES[categoryTitle];
  const trySaying = isVoiceTip ? 'Say "Hey Spotify" ' : "Try saying: ";
  const subtitle = VOICE_TIPS[categoryTitle];

  return (
    <div
      data-testid={isActive ? "selected-item-title" : ""}
      className={classNames(styles.inlineTipItem, {
        [styles.toTheLeft]: isLeft,
        [styles.hidden]: isHidden,
        [styles.voiceTip]: isVoiceTip,
      })}
    >
      <Type name="brioBold">{title}</Type>
      <div className={styles.subtitle}>
        <Type name="celloBook">
          <span className={styles.tryThis}>{trySaying}</span>
          {subtitle}
        </Type>
      </div>
    </div>
  );
};

export default InlineTipItem;
