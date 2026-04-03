import { useState } from 'react';
import classNames from 'classnames';
import { useCarThingStore } from '../../../../contexts/CarThingStore';
import { IconMicOn64, IconMicOff64 } from '../../../Icons/CarthingUIComponents';
import Type from '../../../CarthingUIComponents/Type/Type';
import styles from './ShelfSwiperItem.module.scss';

const pointerListenersMaker = (setTouchDown) => ({
  onPointerDown: () => setTouchDown(true),
  onPointerUp: () => setTouchDown(false),
  onPointerLeave: () => setTouchDown(false),
});

const DefaultVoiceItem = ({ item, isActive }) => {
  const { shelfStore } = useCarThingStore();
  const uiState = shelfStore.shelfController.shelfSwiperItemUiState;
  const { category } = item;
  const [touchDown, setTouchDown] = useState(false);

  return (
    <div
      className={classNames(styles.buttonItem, {
        [styles.activeSlide]: isActive,
        [styles.pressed]: (uiState.isDialPressed && isActive) || touchDown,
        [styles.notEnabled]: !uiState.isMicEnabled,
      })}
      onClick={(e) => {
        e.stopPropagation();
        uiState.pushToTalkClicked(item);
      }}
    >
      {isActive && <div className={`${styles.activeBorder} ${styles.circle}`} />}
      <div className={`${styles.buttonArtwork} ${styles.circle}`} {...pointerListenersMaker(setTouchDown)} />
      <div className={`${styles.buttonIcon} ${styles.artworkCenter}`}>
        {uiState.isMicEnabled ? <IconMicOn64 /> : <IconMicOff64 />}
      </div>
      <div className={styles.titleContainer}>
        <Type name="celloBold" className={styles.title}>
          Tap to use voice
        </Type>
      </div>
    </div>
  );
};

export default DefaultVoiceItem;