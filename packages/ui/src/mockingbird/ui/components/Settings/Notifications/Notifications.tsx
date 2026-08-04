import { observer } from "mobx-react-lite";
import { useCarThingStore } from "../../../contexts/CarThingStore";
import SubmenuHeader from "../Submenu/SubmenuHeader";
import SubmenuItem from "../Submenu/SubmenuItem";
import styles from "./Notifications.module.scss";

const Notifications = () => {
  const { settingsStore } = useCarThingStore();
  const item = settingsStore.notificationsView.rows?.[0];

  return (
    <>
      <SubmenuHeader icon={null} name="Notifications" />
      <div className={styles.scrollContainer}>
        <div className={styles.submenuItemWrapper}>
          {item ? <SubmenuItem item={item} active /> : null}
        </div>
        <div className={styles.text}>
          Mirrored notifications from your phone will appear onscreen while they
          are active. Existing notifications are not shown when you turn this
          setting back on.
        </div>
      </div>
    </>
  );
};

export default observer(Notifications);
