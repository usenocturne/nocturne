import { useRef } from 'react';
import { observer } from 'mobx-react-lite';
import classNames from 'classnames';
import styles from './PresetCard.module.scss';
import PresetContent from './PresetContent';
import PresetPlaceholder from './PresetPlaceholder';
import { CSSTransition } from 'react-transition-group';
import { useCarThingStore } from '../../../../contexts/CarThingStore';
import PresetUnavailable from './PresetUnavailable';

const transitionStyles = {
  appear: styles.appear,
  appearActive: styles.appearActive,
  exit: styles.exit,
  exitActive: styles.exitActive,
};

const PresetCard = ({ preset }) => {
  const { presetsController } = useCarThingStore();
  const uiState = presetsController.presetsUiState;
  const isFocused = uiState.selectedPresetNumber === preset.slot_index;
  const nodeRef = useRef(null);

  return (
    <CSSTransition
      classNames={transitionStyles}
      timeout={1000}
      in={uiState.currentIsPresets}
      appear
      nodeRef={nodeRef}
    >
      <div
        ref={nodeRef}
        data-testid={`preset-card-${preset.slot_index}`}
        className={classNames(
          styles.presetCard,
          styles[`presetCard${preset.slot_index}`],
          {
            [styles.active]: isFocused,
          },
        )}
        onClick={() => uiState.handleTapOnPreset(preset.slot_index)}
      >
        {preset.type === 'preset' && <PresetContent preset={preset} />}
        {preset.type === 'placeholder' && (
          <PresetPlaceholder isFocused={isFocused} />
        )}
        {preset.type === 'unavailable' && <PresetUnavailable preset={preset} />}
      </div>
    </CSSTransition>
  );
};

export default observer(PresetCard);
