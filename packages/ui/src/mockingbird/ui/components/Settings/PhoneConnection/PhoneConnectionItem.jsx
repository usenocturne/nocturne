import { useCarThingStore } from '../../../contexts/CarThingStore';
import { useState } from 'react';
import styles from './PhoneConnection.module.scss';
import { observer } from 'mobx-react-lite';
import classNames from 'classnames';
import pointerListenersMaker from '../../../helpers/PointerListeners';
import { action } from 'mobx';

const IconMore = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
    <path d="M4.5 13.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm15 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm-7.5 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
  </svg>
);

const PhoneConnectionItem = ({
  phoneName,
  phoneAddress,
  isActive,
  isConnected,
  isConnecting,
}) => {
  const { hardwareStore, phoneConnectionStore } = useCarThingStore();
  const [pressedPhoneItem, setPressedPhoneItem] = useState(false);

  const device = {
    name: phoneName,
    address: phoneAddress,
  };
  const displayConnectionStatus =
    phoneConnectionStore.getPhoneConnectionDisplayStatus(device);

  return (
    <div
      className={classNames(styles.phoneConnectionItem, {
        [styles.active]: isActive,
        [styles.pressed]:
          (hardwareStore.dialPressed && isActive) || pressedPhoneItem,
      })}
      {...pointerListenersMaker(setPressedPhoneItem)}
    >
      <div
        className={styles.titles}
        onClick={action(() =>
          phoneConnectionStore.phoneConnectionContextMenuUiState.handleContextMenuClick(device),
        )}
      >
        <span className={styles.title}>{phoneName}</span>
        <span
          className={classNames(styles.subtitle, {
            [styles.connected]: isConnected,
          })}
        >
          <span className={styles.subtitleText}>{displayConnectionStatus}</span>
          {isConnecting && <div className={styles.spinner} />}
        </span>
      </div>
      <div
        onClick={action(() =>
          phoneConnectionStore.phoneConnectionContextMenuUiState.handleContextMenuClick(
            device,
          ),
        )}
        className={styles.menuButton}
      >
        <IconMore className={styles.menuIcon} />
      </div>
    </div>
  );
};

export default observer(PhoneConnectionItem);
