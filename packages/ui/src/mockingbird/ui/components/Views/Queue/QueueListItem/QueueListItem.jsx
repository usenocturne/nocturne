import classNames from "classnames";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import pointerListenersMaker from "../../../../helpers/PointerListeners";
import styles from "./QueueListItem.module.scss";
import { useCarThingStore } from "../../../../contexts/CarThingStore";
import LazyImage from "../../Npv/PlayingInfo/LazyImage/LazyImage";
import Type from "../../../CarthingUIComponents/Type/Type";

const QueueListItem = ({ item, isActive = false }) => {
  const [pressed, setPressed] = useState(false);
  const { queueStore } = useCarThingStore();
  const uiState = queueStore.queueUiState;

  return (
    <div
      className={classNames(styles.queueListItem, {
        [styles.selected]: isActive,
        [styles.pressed]: pressed || (isActive && uiState.isDialPressed),
      })}
      onClick={() => uiState.handleItemClicked(item)}
      {...pointerListenersMaker(setPressed)}
      data-testid={`queue-item-${item.uri}`}
    >
      <div className={styles.imageContainer}>
        <div className={styles.image} data-testid={`queue-image-${item.uri}`}>
          <LazyImage
            uri={item.uri}
            size={96}
            scale={1.3}
            imageId={item.image_uri}
            isActive={isActive}
          />
        </div>
      </div>
      <div className={styles.trackInfo} data-testid={`queue-info-${item.uri}`}>
        <Type
          className={styles.title}
          name="canonBold"
          dataTestId={`${isActive ? "queue-item-title" : ""}`}
        >
          {item.name}
        </Type>
        <div className={styles.subtitleContainer}>
          {item.explicit && (
            <img
              src="images/explicit.svg"
              alt="explicit"
              className={styles.explicit}
            />
          )}
          <Type
            name="balladBook"
            className={styles.subtitle}
            dataTestId={`${isActive ? "queue-item-subtitle" : ""}`}
          >
            {item.artist_name}
          </Type>
        </div>
      </div>
    </div>
  );
};

export default observer(QueueListItem);
