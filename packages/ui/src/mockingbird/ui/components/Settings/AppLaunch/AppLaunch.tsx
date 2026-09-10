import { observer } from "mobx-react-lite";
import { useCarThingStore } from "../../../contexts/CarThingStore";
import SubmenuHeader from "../Submenu/SubmenuHeader";
import SubmenuItem from "../Submenu/SubmenuItem";
import styles from "./AppLaunch.module.scss";

const AppLaunch = () => {
  const { settingsStore } = useCarThingStore();
  const item = settingsStore.appLaunchView.rows?.[0];

  return (
    <>
      <SubmenuHeader icon={null} name="Auto launch app" />
      <div className={styles.scrollContainer}>
        {item ? <SubmenuItem item={item} active /> : null}
        <div className={styles.text}>
          Open Nocturne in the foreground when your phone connects. May prevent
          some features from working.
          {settingsStore.isAppLaunchSettingSaving ? (
            <p role="status">Saving...</p>
          ) : settingsStore.appLaunchSettingError ? (
            <p role="alert">{settingsStore.appLaunchSettingError}</p>
          ) : !settingsStore.isAppLaunchSettingReady ? (
            <p role="status">Waiting for the device connection...</p>
          ) : null}
        </div>
      </div>
    </>
  );
};

export default observer(AppLaunch);
