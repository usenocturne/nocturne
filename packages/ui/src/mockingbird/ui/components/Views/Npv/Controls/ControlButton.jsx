import { useState } from "react";
import classNames from "classnames";
import styles from "./Controls.module.scss";

const ControlButton = ({
  id,
  children,
  onClick,
  fullSize = false,
  isDisabled = false,
}) => {
  const [touchDown, setTouchDown] = useState(false);

  const handlePointerDown = () => {
    if (!isDisabled) {
      setTouchDown(true);
    }
  };

  const handlePointerUp = () => {
    setTouchDown(false);
  };

  const handlePointerLeave = () => {
    setTouchDown(false);
  };

  const handleClick = (e) => {
    if (!isDisabled && onClick) {
      onClick(e);
    }
  };

  return (
    <div className={styles.controlButton} data-testid={`control-button-${id}`}>
      <div
        className={classNames(styles.touchArea, {
          [styles.touchAreaFullSize]: fullSize,
          [styles.touchAreaDown]: touchDown,
          [styles.disabledIcon]: isDisabled,
        })}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onClick={handleClick}
        style={{
          cursor: isDisabled ? "default" : "pointer",
          userSelect: "none",
          WebkitTouchCallout: "none",
          WebkitUserSelect: "none",
        }}
      >
        {children}
      </div>
    </div>
  );
};

export default ControlButton;
