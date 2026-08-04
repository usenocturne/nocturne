import { useRef } from "react";
import type { ReactNode } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import type { Swiper as SwiperInstance } from "swiper";
import "swiper/css";
import {
  useSwiperNavigation,
  setDragging,
  TRANSITION_DURATION_MS,
} from "../../../hooks/useSwiperNavigation";
interface SwiperCarouselProps<T> {
  items: T[];
  renderItem: (item: T, index: number, isActive: boolean) => ReactNode;
  activeSection: string;
  currentlyPlayingId?: string | null;
  onItemSelect: (index: number) => void;
  keyExtractor: (item: T) => string;
  getItemId?: (item: T) => string | null | undefined;
}

export default function SwiperCarousel({
  items,
  renderItem,
  activeSection,
  currentlyPlayingId,
  onItemSelect,
  keyExtractor,
  getItemId,
}: SwiperCarouselProps<UiContentItem>) {
  const swiperRef = useRef<SwiperInstance | null>(null);

  const playingItemIndex =
    currentlyPlayingId && getItemId
      ? items.findIndex((item) => getItemId(item) === currentlyPlayingId)
      : -1;

  const { selectedIndex, setSelectedIndex } = useSwiperNavigation({
    swiperRef,
    itemCount: items.length,
    activeSection,
    playingItemIndex,
    onItemSelect,
    inactivityTimeout: 3000,
    enabled: true,
  });

  if (!items || items.length === 0) return null;

  return (
    <Swiper
      allowTouchMove
      slidesPerView={1.5}
      spaceBetween={40}
      slidesOffsetBefore={8}
      slidesOffsetAfter={8}
      speed={TRANSITION_DURATION_MS}
      touchStartPreventDefault={false}
      onSwiper={(swiper) => (swiperRef.current = swiper)}
      onTouchStart={() => {
        setDragging(true);
      }}
      onTouchEnd={() => {
        setDragging(false);
      }}
      onTransitionEnd={() => {
        if (
          swiperRef.current &&
          selectedIndex >= 0 &&
          swiperRef.current.activeIndex !== selectedIndex
        ) {
          swiperRef.current.slideTo(selectedIndex);
        }
      }}
      onActiveIndexChange={(swiper) => {
        if (swiper.activeIndex !== selectedIndex) {
          setSelectedIndex(swiper.activeIndex);
        }
      }}
      className="pt-2"
      style={{ overflow: "visible" }}
    >
      {items.map((item, index) => (
        <SwiperSlide key={keyExtractor(item)}>
          {renderItem(item, index, index === selectedIndex)}
        </SwiperSlide>
      ))}
    </Swiper>
  );
}
