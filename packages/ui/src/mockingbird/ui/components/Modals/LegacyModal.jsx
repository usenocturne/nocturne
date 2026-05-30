import { observer } from "mobx-react-lite";
import { useCarThingStore } from "../../contexts/CarThingStore";
import { IconX } from "../Icons/EncoreWeb/IconX";
import styles from "./LegacyModal.module.scss";

const LegacyModal = ({ children }) => {
  const { overlayController } = useCarThingStore();
  const uiState = overlayController.overlayUiState;

  const handleModalOnClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      className={styles.legacyModal}
      data-testid="modal"
      onClick={uiState.handleBackdropOnClick}
    >
      <div
        className={styles.content}
        data-testid="modal-content"
        onClick={handleModalOnClick}
      >
        {uiState.isDismissible && (
          <div
            data-testid="modal-icon-dismissible"
            onClick={() => uiState.maybeShowAModal()}
          >
            <IconX className={styles.icon} iconSize={70} />
          </div>
        )}
        {children}
      </div>
    </div>
  );
};

export default observer(LegacyModal);
