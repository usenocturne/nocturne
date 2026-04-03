import { useCarThingStore } from '../../../../contexts/CarThingStore';
import { action, autorun, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { transitionDurationMs, easingFunction } from '../../../../styles/Variables';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Virtual } from 'swiper/modules';
import ShelfSwiperItem, { ARTWORK_WIDTH } from '../ShelfItem/ShelfSwiperItem';
import 'swiper/scss';
import styles from './ShelfSwiper.module.scss';
import { useState, useRef, useEffect } from 'react';

const SWIPER_WIDTH = 800;
const SWIPER_OFFSET_BEFORE = 50;
const SWIPER_SPACE_BETWEEN = 32;
const SWIPER_OFFSET_AFTER =
  SWIPER_WIDTH - ARTWORK_WIDTH - SWIPER_OFFSET_BEFORE + 2;
const THREE_ARTWORK_WIDTH = 3 * ARTWORK_WIDTH + 2 * SWIPER_SPACE_BETWEEN;
const SWIPER_SLIDES_PER_VIEW =
  3 +
  (SWIPER_WIDTH - THREE_ARTWORK_WIDTH) / (ARTWORK_WIDTH + SWIPER_SPACE_BETWEEN);

const getKey = (item) => {
  return `${item.identifier}-${item.category}`;
};

let dragging = false;
const setDraggingFlag = (value) => { dragging = value; };

const ShelfSwiper = () => {
  const { shelfStore } = useCarThingStore();
  const uiState = shelfStore.shelfController.swiperUiState;
  const swiperRef = useRef(null);
  const [localDragging, setLocalDragging] = useState(false);

  useEffect(() => {
    const setAnimate = (isAnimated) => {
      runInAction(() => { uiState.animateSliding = isAnimated; });
    };
    runInAction(() => setAnimate(false));

    const disposer = autorun(() => {
      const index = uiState.selectedItemIndex;
      const animate = uiState.animateSliding;

      if (index !== undefined && index > -1 && !dragging) {
        if (swiperRef.current) {
          swiperRef.current.slideTo(index, animate ? transitionDurationMs : 0);
          swiperRef.current.wrapperEl.style.transitionTimingFunction = easingFunction;
        }
        setAnimate(true);
      }
    });

    return () => disposer();
  }, [uiState]);

  return (
    <Swiper
      modules={[Virtual]}
      allowTouchMove
      className={styles.container}
      data-testid="shelf-swiper"
      slidesPerView={SWIPER_SLIDES_PER_VIEW}
      onSwiper={(swiper) => (swiperRef.current = swiper)}
      slidesOffsetBefore={SWIPER_OFFSET_BEFORE}
      slidesOffsetAfter={SWIPER_OFFSET_AFTER}
      spaceBetween={SWIPER_SPACE_BETWEEN}
      speed={transitionDurationMs}
      width={SWIPER_WIDTH}
      virtual={{
        addSlidesBefore: 3,
        addSlidesAfter: 1,
      }}
      onTouchStart={() => {
        setDraggingFlag(true);
        setLocalDragging(true);
      }}
      onTouchEnd={() => {
        setDraggingFlag(false);
        setLocalDragging(false);
      }}
      onTransitionEnd={() => {
        if (!dragging && swiperRef.current?.activeIndex !== uiState.selectedItemIndex) {
          swiperRef.current?.slideTo(uiState.selectedItemIndex);
        }
      }}
      onActiveIndexChange={action((swiper) => {
        if (swiper.activeIndex !== uiState.selectedItemIndex) {
          uiState.handleDraggedToIndex(swiper.activeIndex);
        }
      })}
      touchStartPreventDefault={false}
    >
      {uiState.allShelfItems.map((item, index) => {
        return (
          <SwiperSlide
            key={getKey(item)}
            virtualIndex={index}
            onClick={() => uiState.dismissBanner()}
          >
            {({ isActive }) => <ShelfSwiperItem {...{ isActive, item }} />}
          </SwiperSlide>
        );
      })}
    </Swiper>
  );
};

export default observer(ShelfSwiper);
