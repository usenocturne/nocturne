import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import styles from "./StartSetup.module.scss";
import SetupHelp from "./SetupHelp";

const QR_URL = "https://usenocturne.com/app";

const StartSetup = () => {
  const [showHelp, setShowHelp] = useState(false);

  if (showHelp) {
    return <SetupHelp onBackToStart={() => setShowHelp(false)} />;
  }

  return (
    <div className={styles.screen}>
      <div className={styles.title}>Start setup</div>
      <div className={styles.content}>
        <div className={styles.texts}>
          <div className={styles.subtitle}>
            Point your phone's camera at this QR code and tap the link that
            appears.
          </div>
          <div className={styles.needHelp} onClick={() => setShowHelp(true)}>
            Need some help?
          </div>
        </div>
        <div className={styles.qrContainer}>
          <QRCodeSVG
            value={QR_URL}
            size={192}
            level="H"
            bgColor="transparent"
            fgColor="#000000"
          />
        </div>
      </div>
    </div>
  );
};

export default StartSetup;
