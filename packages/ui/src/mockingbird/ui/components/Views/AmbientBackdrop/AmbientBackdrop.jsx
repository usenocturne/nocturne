import { useCarThingStore } from "../../../contexts/CarThingStore";
import { observer } from "mobx-react-lite";
import { useRef } from "react";
import styles from "./AmbientBackdrop.module.scss";

const AmbientBackdrop = ({ imageId, getBackgroundStyleAttribute }) => {
  const backdropRef = useRef(null);
  const { imageStore } = useCarThingStore();

  if (imageId && imageId.trim()) {
    imageStore.loadColor(imageId);
  }

  const currentColor = imageStore.colors.get(imageId);
  let background = "rgb(26, 26, 26)";

  if (currentColor) {
    background = getBackgroundStyleAttribute(currentColor);
  } else if (backdropRef.current && backdropRef.current.style.background) {
    background = backdropRef.current.style.background;
  }

  return (
    <div
      ref={backdropRef}
      className={styles.ambientBackdrop}
      style={{ background }}
    />
  );
};

export default observer(AmbientBackdrop);
