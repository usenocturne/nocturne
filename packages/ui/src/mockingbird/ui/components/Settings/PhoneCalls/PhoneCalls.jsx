import { observer } from 'mobx-react-lite';
import SubmenuHeader from '../Submenu/SubmenuHeader';
import styles from './PhoneCalls.module.scss';

const PhoneCalls = () => {
  return (
    <>
      <SubmenuHeader icon={null} name="Phone calls" />
      <div className={styles.scrollContainer}>
        <div className={styles.submenuItemWrapper}>
          <div className={styles.toggleRow}>
            <span className={styles.label}>Phone calls onscreen</span>
            <span className={styles.value}>Off</span>
          </div>
        </div>
        <div className={styles.text}>
          If turned on, you'll see your incoming and outgoing phone call info
          on your screen and will be able to answer or decline calls. Be sure
          your phone is connected to the car's speakers and microphone.
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
