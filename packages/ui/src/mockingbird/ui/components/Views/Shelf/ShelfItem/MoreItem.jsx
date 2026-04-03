import { useState } from 'react';
import classNames from 'classnames';
import { useCarThingStore } from '../../../../contexts/CarThingStore';
import { IconChevronRight48 } from '../../../Icons/CarthingUIComponents';
import Type from '../../../CarthingUIComponents/Type/Type';
import styles from './ShelfSwiperItem.module.scss';
import moreStyles from './MoreItem.module.scss';

const pointerListenersMaker = (setTouchDown) => ({
  onPointerDown: () => setTouchDown(true),
  onPointerUp: () => setTouchDown(false),
  onPointerLeave: () => setTouchDown(false),
});

const MoreItem = ({ isActive, item }) => {
  const { category, title } = item;
  const { shelfStore } = useCarThingStore();
  const uiState = shelfStore.shelfController.shelfSwiperItemUiState;
  const [touchDown, setTouchDown] = useState(false);

  return (
    <div
      className={classNames(styles.buttonItem, {
        [styles.activeSlide]: isActive,
        [styles.pressed]: (uiState.isDialPressed && isActive) || touchDown,
      })}
      onClick={() => uiState.moreButtonClicked(item.category)}
    >
      {isActive && <div className={styles.activeBorder} />}
      <div className={styles.buttonArtwork} {...pointerListenersMaker(setTouchDown)} />
      <div className={`${moreStyles.moreIcon} ${styles.artworkCenter}`} />
      <div className={styles.artworkCenter}>
        <IconChevronRight48 />
      </div>
      <div className={styles.titleContainer}>
        <Type name="celloBold" className={styles.title}>
          {title ?? 'More'}
        </Type>
      </div>
    </div>
  );
};

export default MoreItem;
