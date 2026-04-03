import { useCarThingStore } from '../../../../contexts/CarThingStore';
import MoreItem from './MoreItem';
import ContextItem from './ContextItem';
import InlineTipItem from './InlineTipItem';
import DefaultVoiceItem from './DefaultVoiceItem';
import styles from './ShelfSwiperItem.module.scss';

export const ARTWORK_WIDTH = 240;

const ShelfSwiperItem = ({ item, isActive }) => {
  const { shelfStore } = useCarThingStore();
  const uiState = shelfStore.shelfController.shelfSwiperItemUiState;

  return (
    <div data-selected={isActive ? 'true' : 'false'}>
      {uiState.isMoreItem(item) && <MoreItem isActive={isActive} item={item} />}
      {uiState.isContextItem(item) && <ContextItem item={item} isActive={isActive} />}
      {uiState.isTextPlaceholder(item) && <InlineTipItem item={item} isActive={isActive} />}
      {uiState.isSpacerItem(item) && <div className={styles.artwork} />}
      {uiState.isVoiceDefaultItem(item) && uiState.showPushToTalk && (
        <DefaultVoiceItem item={item} isActive={isActive} />
      )}
    </div>
  );
};

export default ShelfSwiperItem;