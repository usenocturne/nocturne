import styles from './SetupHelp.module.scss';

const SetupHelp = ({ onBackToStart }) => {
  return (
    <div className={styles.screen}>
      <div className={styles.content}>
        <div className={styles.texts}>
          <div className={styles.subtitle}>
            Here's another way to start setup:
          </div>
          <div className={styles.subtitle}>
            <ul className={styles.subtitle}>
              <li>
                Open <span className={styles.white}>usenocturne.com/app</span> on
                your phone
              </li>
              <li>
                Follow the instructions to pair your phone
              </li>
              <li>
                Make sure <span className={styles.white}>Bluetooth</span> is enabled
                on your phone
              </li>
            </ul>
          </div>
        </div>
        <div
          className={styles.backToSetup}
          onClick={() => onBackToStart()}
        >
          Back to Start setup
        </div>
      </div>
    </div>
  );
};

export default SetupHelp;
