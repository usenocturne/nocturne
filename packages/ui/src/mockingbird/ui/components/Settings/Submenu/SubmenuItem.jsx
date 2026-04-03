import classNames from 'classnames';
import { useCarThingStore } from '../../../contexts/CarThingStore';
import { useState } from 'react';
import pointerListenersMaker from '../../../helpers/PointerListeners';
import styles from './SubmenuItem.module.scss';
import { observer } from 'mobx-react-lite';

const OnOrOff = ({ id, isToggleOn, active }) => (
  <div
    className={classNames(
      styles.onOffToggle,
      isToggleOn ? styles.green : styles.white70,
      { [styles.movedForDial]: active },
    )}
  >
    <span className={styles.toggleText}>{isToggleOn ? 'On' : 'Off'}</span>
  </div>
);

const SubmenuItem = ({ item, active }) => {
  const { label, disabledOffline, type, id } = item;
  const [pressed, setPressed] = useState(false);
  const { hardwareStore, settingsStore } = useCarThingStore();
  const uiState = settingsStore.submenuUiState;

  const disabled = disabledOffline;

  return (
    <div
      className={classNames(styles.item, {
        [styles.active]: active,
        [styles.pressed]: (hardwareStore.dialPressed && active) || pressed,
        [styles.disabled]: disabled,
      })}
      {...pointerListenersMaker(setPressed)}
      onClick={() =>
        disabled
          ? uiState.showUnavailableBanner()
          : uiState.handleSubmenuItemClicked(item)
      }
    >
      <span className={styles.labelText}>{label}</span>
      {(() => {
        switch (type) {
          case 'toggle':
            return (
              <OnOrOff
                active={active}
                id={id}
                isToggleOn={uiState.isToggleOn(item)}
              />
            );
          case 'key-value':
            return (
              <span
                className={classNames(styles.keyValueValue, {
                  [styles.movedForDial]: active,
                })}
              >
                {uiState.getKeyValue(item)}
              </span>
            );
          default:
            return null;
        }
      })()}
    </div>
  );
};

export default observer(SubmenuItem);
