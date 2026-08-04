import styles from "./EmptyQueueState.module.scss";
import Type from "../../../CarthingUIComponents/Type/Type";

const EmptyQueueState = () => {
  return (
    <div className={styles.emptyBody} data-testid="empty-body">
      <Type className={styles.infoText} name="balladBook" textColor="gray-70">
        Add a Song or Podcast Episode by tapping on the "add to queue" icon.
      </Type>
    </div>
  );
};

export default EmptyQueueState;
