import { observer } from "mobx-react-lite";
import styles from "./PresetPlaceholder.module.scss";
import Type from "../../../CarthingUIComponents/Type/Type";
import classNames from "classnames";

const PresetPlaceholder = ({ isFocused }) => {
  return (
    <div className={styles.presetPlaceholder}>
      <Type
        name="mestroBold"
        className={classNames(styles.title, { [styles.active]: isFocused })}
      >
        Press and hold the preset button to save what's playing
      </Type>
    </div>
  );
};

export default observer(PresetPlaceholder);
