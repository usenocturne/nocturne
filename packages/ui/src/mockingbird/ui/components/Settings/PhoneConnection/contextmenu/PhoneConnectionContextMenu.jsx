import { useCarThingStore } from "../../../../contexts/CarThingStore";
import { observer } from "mobx-react-lite";
import styles from "./PhoneConnectionContextMenu.module.scss";
import classNames from "classnames";
import PhoneConnectionContextMenuItem from "./PhoneConnectionContextMenuItem";

const PhoneConnectionContextMenu = () => {
  const uiState =
    useCarThingStore().phoneConnectionStore.phoneConnectionContextMenuUiState;

  return (
    <div className={styles.phoneConnectionContextMenu}>
      <div className={styles.header}>
        <div className={styles.headerDetails}>
          <span className={styles.headerName}>{uiState.phoneName}</span>
          <span
            className={classNames(styles.subtitle, {
              [styles.connected]: uiState.isConnected,
            })}
          >
            {uiState.displayConnectionStatus}
          </span>
        </div>
      </div>
      <div className={styles.menuList}>
        {uiState.menuItems.map((item, index) => (
          <PhoneConnectionContextMenuItem
            key={item}
            item={item}
            isActive={uiState.isActive(index)}
            dialPressed={uiState.isDialPressed}
          />
        ))}
      </div>
    </div>
  );
};

export default observer(PhoneConnectionContextMenu);
