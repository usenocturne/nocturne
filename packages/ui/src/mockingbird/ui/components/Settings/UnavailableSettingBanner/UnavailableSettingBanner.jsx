import { useCarThingStore } from '../../../contexts/CarThingStore';
import { observer } from 'mobx-react-lite';
import styles from './UnavailableSettingBanner.module.scss';
import classNames from 'classnames';

const IconInfo32 = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
  </svg>
);

const UnavailableSettingBanner = () => {
  const uiState = useCarThingStore().settingsStore.unavailableSettingsBannerUiState;

  return (
    <div
      className={classNames(styles.banner, {
        [styles.show]: uiState.shouldShowAlert,
      })}
    >
      <div className={styles.icon}>
        <IconInfo32 />
      </div>
      <span className={styles.text}>
        This setting is unavailable in Mockingbird UI mode.
      </span>
    </div>
  );
};

export default observer(UnavailableSettingBanner);
