import { useCarThingStore } from '../../../contexts/CarThingStore';
import { useEffect, useState, useRef } from 'react';
import styles from './PhoneConnection.module.scss';
import { observer } from 'mobx-react-lite';
import SubmenuHeader from '../Submenu/SubmenuHeader';
import { Swiper as SwiperComponent, SwiperSlide } from 'swiper/react';
import classNames from 'classnames';
import pointerListenersMaker from '../../../helpers/PointerListeners';
import PhoneConnectionItem from './PhoneConnectionItem';
import PhoneConnectionModal from './PhoneConnectionModal';
import PhoneConnectionContextMenu from './contextmenu/PhoneConnectionContextMenu';
import { runInAction } from 'mobx';
import variables from '../../../styles/variables.module.scss';

const easingFunction = variables['easing-function'] || 'cubic-bezier(0.16, 1, 0.3, 1)';
const transitionDurationMs = parseInt(variables['transition-duration-ms'], 10) || 500;

const DEVICE_HEIGHT = 480;
const HEADER_HEIGHT = 144;
const ITEM_HEIGHT = 128;
const SWIPER_HEIGHT = DEVICE_HEIGHT - HEADER_HEIGHT;
const SLIDES_PER_VIEW = SWIPER_HEIGHT / ITEM_HEIGHT;

const IconMobile64 = () => (
  <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor">
    <path d="M5 5a3 3 0 013-3h8a3 3 0 013 3v14a3 3 0 01-3 3H8a3 3 0 01-3-3V5zm3-1a1 1 0 00-1 1v14a1 1 0 001 1h8a1 1 0 001-1V5a1 1 0 00-1-1H8z" />
    <path d="M13.25 16.75a1.25 1.25 0 11-2.5 0 1.25 1.25 0 012.5 0z" />
  </svg>
);

const PhoneConnection = () => {
  const {
    settingsStore,
    bluetoothStore,
    hardwareStore,
    phoneConnectionStore,
  } = useCarThingStore();

  const [swiper, setSwiper] = useState(null);
  const [pressedAddMoreItem, setPressedAddMoreItem] = useState(false);

  const menuShowing = phoneConnectionStore.phoneConnectionContextMenuUiState.phoneMenuShowing;
  const [menuRendered, setMenuRendered] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);
  const prevMenuRef = useRef(menuShowing);

  useEffect(() => {
    if (menuShowing && !prevMenuRef.current) {
      setMenuRendered(true);
      setMenuClosing(false);
    } else if (!menuShowing && prevMenuRef.current) {
      setMenuClosing(true);
      const timer = setTimeout(() => {
        setMenuRendered(false);
        setMenuClosing(false);
      }, transitionDurationMs);
      prevMenuRef.current = menuShowing;
      return () => clearTimeout(timer);
    }
    prevMenuRef.current = menuShowing;
  }, [menuShowing]);

  const getSlideOffsetAfter = () => {
    if (bluetoothStore.bluetoothDeviceList.length === 0) {
      return SWIPER_HEIGHT - HEADER_HEIGHT - ITEM_HEIGHT * 3;
    } else if (bluetoothStore.bluetoothDeviceList.length === 1) {
      return SWIPER_HEIGHT - HEADER_HEIGHT - ITEM_HEIGHT / 2;
    }
    return DEVICE_HEIGHT - HEADER_HEIGHT - ITEM_HEIGHT;
  };

  useEffect(() => {
    const effect = () => {
      if (swiper && settingsStore.currentIsPhoneConnection) {
        swiper.slideTo(settingsStore.currentView.index);
        swiper.wrapperEl.style.transitionTimingFunction = easingFunction;
      }
    };
    runInAction(effect);
  }, [
    settingsStore.currentIsPhoneConnection,
    settingsStore.currentView.index,
    swiper,
  ]);

  useEffect(() => {
    bluetoothStore.triggerBTDeviceList();
    return () => phoneConnectionStore.unmountPhoneConnectionView();
  }, [bluetoothStore, phoneConnectionStore]);

  const addPhoneItemIsActive =
    settingsStore.currentView.index ===
    bluetoothStore.bluetoothDeviceList.length;

  return (
    <div className={classNames(styles.phoneConnection)}>
      <SubmenuHeader
        name={settingsStore.phoneConnectionView.label}
        icon={<IconMobile64 />}
      />
      <SwiperComponent
        setWrapperSize
        direction="vertical"
        slidesPerView={SLIDES_PER_VIEW}
        onSwiper={setSwiper}
        height={SWIPER_HEIGHT}
        width={800}
        initialSlide={0}
        slidesOffsetAfter={getSlideOffsetAfter()}
        onActiveIndexChange={(swiperInstance) =>
          settingsStore.handleSettingSetNewIndex(swiperInstance.activeIndex)
        }
      >
        {bluetoothStore.bluetoothDeviceList?.map((phone, index) => {
          const isConnected = phone.connected || false;
          const isConnecting =
            bluetoothStore.currentDevice?.address === phone.address && !isConnected;
          const isActive = settingsStore.currentView.index === index;

          return (
            <SwiperSlide key={phone.address}>
              <PhoneConnectionItem
                phoneName={bluetoothStore.getDeviceName(phone)}
                phoneAddress={phone.address}
                isActive={isActive}
                isConnected={isConnected}
                isConnecting={isConnecting}
              />
            </SwiperSlide>
          );
        })}
        <SwiperSlide
          className={classNames(
            styles.phoneConnectionItem,
            styles.addMorePhone,
            {
              [styles.active]: addPhoneItemIsActive,
              [styles.pressed]:
                pressedAddMoreItem ||
                (addPhoneItemIsActive && hardwareStore.dialPressed),
            },
          )}
          {...pointerListenersMaker(setPressedAddMoreItem)}
          onClick={() => phoneConnectionStore.handleAddNewPhoneClick()}
        >
          <div className={styles.title}>Add a new phone</div>
        </SwiperSlide>
      </SwiperComponent>
      {menuRendered && (
        <div className={classNames(styles.contextMenuOverlay, {
          [styles.contextMenuClosing]: menuClosing,
        })}>
          <PhoneConnectionContextMenu />
        </div>
      )}
      <PhoneConnectionModal />
    </div>
  );
};

export default observer(PhoneConnection);
