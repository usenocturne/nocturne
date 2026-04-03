import styles from './BTPairing.module.scss';

const parsePincode = (pinCode) => {
  if (!pinCode) return pinCode;
  return pinCode.split('').join(' ');
};

const BTPairing = ({ pin }) => {
  return (
    <div className={styles.screen} data-testid="bt-pairing-screen">
      <div className={styles.title}>Pairing code</div>
      <div className={styles.content}>
        <div className={styles.texts}>
          In the Settings app, confirm that you see the code below.
        </div>
        <div className={styles.pinCode} data-testid="bt-pin">
          {parsePincode(pin)}
        </div>
      </div>
    </div>
  );
};

export default BTPairing;
