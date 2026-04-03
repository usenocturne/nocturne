import { useState } from "react";
import styles from "./BannerButton.module.scss";
import classNames from "classnames";
import Type from "../Type/Type";

const BannerButton = ({
  withDivider = false,
  text,
  colors = "information",
  onClick,
}) => {
  const [buttonPressed, setButtonPressed] = useState(false);

  return (
    <div
      key={text}
      data-testid={`${text}-button`}
      className={classNames(styles.buttonContainer, {
        [styles.confirmation]: colors === "confirmation",
        [styles.information]: colors === "information",
        [styles.unavailable]: colors === "unavailable",
      })}
      onClick={() => {
        onClick();
      }}
      onTouchStart={() => setButtonPressed(true)}
      onTouchEnd={() => setButtonPressed(false)}
    >
      {withDivider && <div className={styles.divider} />}
      <div
        className={classNames(styles.bannerButton, styles.touchArea, {
          [styles.pressed]: buttonPressed,
        })}
        onTouchStart={() => setButtonPressed(true)}
        onTouchEnd={() => setButtonPressed(false)}
      >
        <Type name="minuet" className={styles.buttonText}>
          {text}
        </Type>
      </div>
    </div>
  );
};

export default BannerButton;
