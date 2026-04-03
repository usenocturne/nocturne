import PhoneForgetConfirm from "./PhoneForgetConfirm";
import { useCarThingStore } from "../../../contexts/CarThingStore";
import { PhoneConnectionModalView } from "../../../stores/PhoneConnectionStore";
import { observer } from "mobx-react-lite";
import styles from "./PhoneConnectionModal.module.scss";
import { useEffect, useState, useRef } from "react";

const IconCheck = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={styles.iconCheck}
  >
    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
  </svg>
);

const Spinner = () => <div className={styles.spinnerBig} />;

const ModalContent = observer(({ modalView, phoneConnectionStore }) => {
  switch (modalView) {
    case PhoneConnectionModalView.ADD_NEW_PHONE:
      return (
        <>
          <div className={styles.title}>Pairing mode</div>
          <div className={styles.description}>
            Go to Bluetooth in your phone's settings and connect to your Car
            Thing.
          </div>
        </>
      );
    case PhoneConnectionModalView.ADD_NEW_PAIRING:
      return (
        <>
          <div className={styles.title}>Pairing...</div>
          <div className={styles.description}>
            Confirm that you see the code below on your phone.
          </div>
          <div className={styles.pairingCode}>------</div>
        </>
      );
    case PhoneConnectionModalView.FORGET_PHONE_CONFIRM:
      return <PhoneForgetConfirm />;
    case PhoneConnectionModalView.FORGET_PHONE_PROGRESS:
      return (
        <>
          <Spinner />
          <div className={styles.subtitle}>
            <p>Forgetting</p>
            <p>{phoneConnectionStore.phoneToConnectOrForget?.name}...</p>
          </div>
        </>
      );
    case PhoneConnectionModalView.FORGET_PHONE_FAILURE:
      return (
        <>
          <div className={styles.title}>Couldn't forget phone</div>
          <div className={styles.description}>
            <p>Car Thing is having trouble forgetting your phone.</p>
          </div>
        </>
      );
    case PhoneConnectionModalView.FORGET_PHONE_SUCCESS:
      return (
        <>
          <IconCheck />
          <div className={styles.subtitle}>
            <p>{phoneConnectionStore.phoneToConnectOrForget?.name}</p>
            <p> is forgotten</p>
          </div>
        </>
      );
    case PhoneConnectionModalView.SELECT_PHONE_PROGRESS:
      return (
        <>
          <Spinner />
          <div className={styles.subtitle}>
            <p>Connecting to</p>
            <p>{phoneConnectionStore.phoneToConnectOrForget?.name}...</p>
          </div>
        </>
      );
    case PhoneConnectionModalView.PHONE_SWITCH_SUCCESS:
      return (
        <>
          <IconCheck />
          <div className={styles.subtitle}>
            <p>Connected to</p>
            <p>{phoneConnectionStore.phoneToConnectOrForget?.name}</p>
          </div>
        </>
      );
    case PhoneConnectionModalView.SELECT_PHONE_FAILURE:
      return (
        <>
          <div className={styles.title}>Couldn't connect to phone</div>
          <div className={styles.description}>
            <p>
              Car Thing is having trouble connecting to your phone. Make sure
              your phone is turned on, Bluetooth is on and in range.
            </p>
          </div>
        </>
      );
    default:
      return null;
  }
});

const ANIM_DURATION = 300;

const PhoneConnectionModal = () => {
  const { phoneConnectionStore } = useCarThingStore();
  const currentModal = phoneConnectionStore.phoneConnectionModal;

  const [rendered, setRendered] = useState(false);
  const [closing, setClosing] = useState(false);
  const lastModalRef = useRef(currentModal);

  useEffect(() => {
    if (currentModal !== undefined) {
      setRendered(true);
      setClosing(false);
      lastModalRef.current = currentModal;
    } else if (lastModalRef.current !== undefined) {
      setClosing(true);
      const timer = setTimeout(() => {
        setRendered(false);
        setClosing(false);
        lastModalRef.current = undefined;
      }, ANIM_DURATION);
      return () => clearTimeout(timer);
    }
  }, [currentModal]);

  if (!rendered) return null;

  const modalView = closing ? lastModalRef.current : currentModal;

  return (
    <div
      className={`${styles.overlay} ${closing ? styles.overlayClosing : ""}`}
    >
      <div className={styles.dialog}>
        <ModalContent
          modalView={modalView}
          phoneConnectionStore={phoneConnectionStore}
        />
      </div>
    </div>
  );
};

export default observer(PhoneConnectionModal);
