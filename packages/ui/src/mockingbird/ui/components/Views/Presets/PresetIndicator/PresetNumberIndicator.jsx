import { observer } from 'mobx-react-lite';
import styles from './PresetNumberIndicator.module.scss';
import Type from '../../../CarthingUIComponents/Type/Type';
import classNames from 'classnames';
import { useCarThingStore } from '../../../../contexts/CarThingStore';

const PresetNumberIndicator = ({ presetNumber }) => {
  const { presetsController } = useCarThingStore();
  const uiState = presetsController.presetsUiState;

  const isFocused = uiState.selectedPresetNumber === presetNumber;
  
  return (
    <div
      data-testid={`preset-indicator-number-${presetNumber}`}
      className={classNames(styles.presetTopWrapper, {
        [styles.active]: isFocused,
      })}
      key={`preset-number-${presetNumber}`}
    >
      <div className={styles.presetIndicator} />

      <div className={styles.presetNumber}>
        <Type name="mestroBold" className={styles.number}>
          {presetNumber}
        </Type>
      </div>
    </div>
  );
};

export default observer(PresetNumberIndicator);