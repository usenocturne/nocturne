import SubmenuHeader from "../Submenu/SubmenuHeader";
import SubmenuItem from "../Submenu/SubmenuItem";
import { useCarThingStore } from "../../../contexts/CarThingStore";
import { observer } from "mobx-react-lite";
import styles from "./PhoneCalls.module.scss";

const PhoneCalls = () => {
  const { settingsStore } = useCarThingStore();
  const item = settingsStore.phoneCallsView.rows?.[0];

  return (
    <>
      <SubmenuHeader icon={null} name="Phone calls" />
      <div className={styles.scrollContainer}>
        <div className={styles.submenuItemWrapper}>
          {item ? <SubmenuItem item={item} active /> : null}
        </div>
        <div className={styles.text}>
          You'll see incoming phone call information on your screen and will be
          able to answer or decline calls. Be sure your phone is connected to
          the car's speakers and microphone.
          <br />
          <br />
          If your phone can't be connected to the car's microphone, place your
          phone close enough to use the phone's microphone.
        </div>
      </div>
    </>
  );
};

export default observer(PhoneCalls);
