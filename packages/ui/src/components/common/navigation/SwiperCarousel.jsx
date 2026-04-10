import { useRef } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import "swiper/css";
import {
  useSwiperNavigation,
  setDragging,
  TRANSITION_DURATION_MS,
} from "../../../hooks/useSwiperNavigation";

export default function SwiperCarousel({
  items,
  renderItem,
  activeSection,
  currentlyPlayingId,
  onItemSelect,
  keyExtractor,
  getItemId,
}) {
  const swiperRef = useRef(null);

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
