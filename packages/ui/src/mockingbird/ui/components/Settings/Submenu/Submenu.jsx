import { useCarThingStore } from "../../../contexts/CarThingStore";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { runInAction } from "mobx";
import { Swiper as SwiperComponent, SwiperSlide } from "swiper/react";
import styles from "./Submenu.module.scss";
import SubmenuHeader from "./SubmenuHeader";
import SubmenuItem from "./SubmenuItem";
import { iconMapping } from "../MainMenu/MainMenuItem";
import variables from "../../../styles/variables.module.scss";

const easingFunction =
  variables["easing-function"] || "cubic-bezier(0.16, 1, 0.3, 1)";

const DEVICE_HEIGHT = 480;
const HEADER_HEIGHT = 144;
const ITEM_HEIGHT = 96;
const SWIPER_HEIGHT = DEVICE_HEIGHT - HEADER_HEIGHT;
const SLIDES_PER_VIEW = SWIPER_HEIGHT / ITEM_HEIGHT;
const OFFSET_AFTER = DEVICE_HEIGHT - HEADER_HEIGHT - ITEM_HEIGHT;

const Submenu = ({ view }) => {
  const [swiper, setSwiper] = useState(null);
  const { settingsStore } = useCarThingStore();

  useEffect(() => {
    const effect = () => {
      if (swiper && settingsStore.currentView.id === view.id) {
        swiper.slideTo(settingsStore.currentView.index);
        swiper.wrapperEl.style.transitionTimingFunction = easingFunction;
      }
    };
    runInAction(effect);
  }, [
    settingsStore.currentView.index,
    settingsStore.currentView.id,
    swiper,
    view.id,
  ]);

  return (
    <div className={styles.submenu}>
      <SubmenuHeader name={view.label} icon={iconMapping[view.id]} />
      <SwiperComponent
        setWrapperSize
        direction="vertical"
        slidesPerView={SLIDES_PER_VIEW}
        onSwiper={setSwiper}
        height={SWIPER_HEIGHT}
        width={800}
        initialSlide={settingsStore.currentView.index}
        onActiveIndexChange={(swiperInstance) =>
          settingsStore.handleSettingSetNewIndex(swiperInstance.activeIndex)
        }
        slidesOffsetAfter={OFFSET_AFTER}
      >
        {view.rows?.map((item, index) => (
          <SwiperSlide key={item.id}>
            <SubmenuItem
              item={item}
              active={settingsStore.currentView.index === index}
            />
          </SwiperSlide>
        ))}
      </SwiperComponent>
    </div>
  );
};

export default observer(Submenu);
