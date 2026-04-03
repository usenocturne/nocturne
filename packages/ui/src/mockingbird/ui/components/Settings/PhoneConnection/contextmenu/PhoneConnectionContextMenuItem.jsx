import classNames from "classnames";
import { useState } from "react";
import pointerListenersMaker from "../../../../helpers/PointerListeners";
import styles from "./PhoneConnectionContextMenu.module.scss";
import { useCarThingStore } from "../../../../contexts/CarThingStore";
import { action } from "mobx";

const IconBluetooth = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
    <path d="M11.713 2.307a.75.75 0 01.817.163l4.5 4.5a.75.75 0 010 1.06L13.06 12l3.97 3.97a.75.75 0 010 1.06l-4.5 4.5a.75.75 0 01-1.28-.53v-7.19l-3.22 3.22a.75.75 0 01-1.06-1.06L10.94 12 6.97 8.03a.75.75 0 011.06-1.06l3.22 3.22V3a.75.75 0 01.463-.693zm1.037 11.504v5.378l2.69-2.689-2.69-2.69zm0-3.622L15.44 7.5l-2.69-2.69v5.38z" />
  </svg>
);

const IconX = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
    <path d="M3.293 3.293a1 1 0 011.414 0L12 10.586l7.293-7.293a1 1 0 111.414 1.414L13.414 12l7.293 7.293a1 1 0 01-1.414 1.414L12 13.414l-7.293 7.293a1 1 0 01-1.414-1.414L10.586 12 3.293 4.707a1 1 0 010-1.414z" />
  </svg>
);

const iconMapping = {
  Connect: <IconBluetooth />,
  Forget: <IconX />,
};

const PhoneConnectionContextMenuItem = ({
  item,
  isActive = false,
  dialPressed = false,
}) => {
  const [pressedMenuItem, setPressedMenuItem] = useState(false);
  const { phoneConnectionStore } = useCarThingStore();

  return (
    <div
      className={classNames(styles.item, {
        [styles.active]: isActive,
        [styles.pressed]: pressedMenuItem || (dialPressed && isActive),
      })}
      {...pointerListenersMaker(setPressedMenuItem)}
      onClick={action(() =>
        phoneConnectionStore.phoneConnectionContextMenuUiState.handleActionMenuItemClick(
          item,
        ),
      )}
    >
      <div className={styles.icon}>{iconMapping[item]}</div>
      <span className={styles.label}>{item}</span>
    </div>
  );
};

export default PhoneConnectionContextMenuItem;
