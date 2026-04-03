import { useCarThingStore } from "../../../contexts/CarThingStore";
import { observer } from "mobx-react-lite";
import styles from "./PhoneConnectionModal.module.scss";
import classNames from "classnames";

const PhoneForgetConfirm = () => {
  const { phoneConnectionStore, bluetoothStore } = useCarThingStore();

  const isConnected = bluetoothStore.isDeviceConnected(
    phoneConnectionStore.phoneToConnectOrForget?.address,
  );

  return (
    <div>
      <div className={styles.title}>Forget phone?</div>
      <div className={styles.description}>
        {isConnected ? (
          <p>
            You're connected to{" "}
            {phoneConnectionStore.phoneToConnectOrForget?.name}. Are you sure
            you want to forget it?
          </p>
        ) : (
          <p>
            Are you sure you want to forget{" "}
            {phoneConnectionStore.phoneToConnectOrForget?.name}?
          </p>
        )}
      </div>
      <div className={styles.buttons}>
        <button
          className={classNames(styles.button, {
            [styles.primary]: phoneConnectionStore.forgetConfirmationIsActive,
            [styles.secondary]:
              !phoneConnectionStore.forgetConfirmationIsActive,
          })}
          onClick={() => phoneConnectionStore.handlePhoneForgetConfirmClick()}
        >
          Forget
        </button>
        <button
          className={classNames(styles.button, {
            [styles.primary]: !phoneConnectionStore.forgetConfirmationIsActive,
            [styles.secondary]: phoneConnectionStore.forgetConfirmationIsActive,
          })}
          onClick={() => phoneConnectionStore.dismissModal()}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default observer(PhoneForgetConfirm);
