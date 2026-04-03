import classNames from 'classnames';
import { useCarThingStore } from '../../../../contexts/CarThingStore';
import { useSwiperDial } from '../../../../hooks/useSwiperDial';
import { action } from 'mobx';
import { observer } from 'mobx-react-lite';
import { Virtual } from 'swiper/modules';
import { Swiper, SwiperSlide } from 'swiper/react';
import 'swiper/scss';
import styles from './QueueSwiper.module.scss';
import QueueListItem from '../QueueListItem/QueueListItem';
import { transitionDurationMs } from '../../../../styles/Variables';

const DEVICE_HEIGHT = 480;
const ITEM_HEIGHT = 128;
const CENTER_DIFF = 68;
const HEADER_HEIGHT = 160;
const SWIPER_HEIGHT = DEVICE_HEIGHT + CENTER_DIFF;
const SLIDES_PER_VIEW = SWIPER_HEIGHT / ITEM_HEIGHT;

const QueueSwiper = () => {
  const { queueStore } = useCarThingStore();
  const uiState = queueStore.queueUiState;
  const { setDragging, swiperRef } = useSwiperDial(uiState);
  
  const getSlideOffsetAfter = () => {
    if (uiState.queue.length === 1) {
      return SWIPER_HEIGHT - HEADER_HEIGHT - ITEM_HEIGHT * 3;
    } else if (uiState.queue.length === 2) {
      return SWIPER_HEIGHT - HEADER_HEIGHT - ITEM_HEIGHT * 2;
    } else if (uiState.queue.length === 3) {
      return SWIPER_HEIGHT - HEADER_HEIGHT - ITEM_HEIGHT;
    }
    return SWIPER_HEIGHT - ITEM_HEIGHT + 2; // 2px for swiperRef end not to break
  };
  
  return (
    <Swiper
      allowTouchMove
      setWrapperSize
      className={styles.container}
      data-testid="queue-swiper"
      direction="vertical"
      slidesPerView={SLIDES_PER_VIEW}
      onSwiper={(swiper) => (swiperRef.current = swiper)}
      height={SWIPER_HEIGHT}
      width={800}
      speed={transitionDurationMs}
      initialSlide={uiState.selectedItemIndex}
      slidesOffsetAfter={getSlideOffsetAfter()}
      modules={[Virtual]}
      virtual={{
        addSlidesBefore: 1,
        addSlidesAfter: 1,
      }}
      onTouchStart={() => setDragging(true)}
      onTouchEnd={() => setDragging(false)}
      onActiveIndexChange={action((swiper) => {
        if (swiper.activeIndex !== uiState.selectedItemIndex) {
          uiState.handleDraggedToIndex(swiper.activeIndex);
        }
      })}
      touchStartPreventDefault={false}
    >
      {uiState.queue.map((item, index) => {
        return (
          <SwiperSlide
            virtualIndex={index}
            key={`${item.uri}:${index}`}
            className={classNames({
              [styles.queueSlideScrolled]: !uiState.isSelectingFirst,
            })}
          >
            {({ isActive }) => (
              <QueueListItem item={item} isActive={isActive} />
            )}
          </SwiperSlide>
        );
      })}
    </Swiper>
  );
};

export default observer(QueueSwiper);