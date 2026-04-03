import { useEffect } from 'react';
import styles from './Presets.module.scss';
import { useSwipeable } from 'react-swipeable';
import { observer } from 'mobx-react-lite';
import { useCarThingStore } from '../../../contexts/CarThingStore';
import { PRESET_NUMBERS } from '../../../stores/PresetsStore';
import PresetNumberIndicator from './PresetIndicator/PresetNumberIndicator';
import PresetCard from './PresetCard/PresetCard';

const SWIPE_TO_DISAPPEAR_LIMIT_PX = 150;

const Presets = () => {
  const { presetsController } = useCarThingStore();
  const uiState = presetsController.presetsUiState;

  useEffect(() => {
    uiState.logPresetsImpression();
  }, [uiState]);

  const swipeUpHandler = (event) => {
    if (event.absY > SWIPE_TO_DISAPPEAR_LIMIT_PX) {
      uiState.handleSwipeUp();
    }
  };

  const swipeHandlers = useSwipeable({ onSwipedUp: swipeUpHandler });
  
  return (
    <div
      className={styles.presetsBackground}
      {...swipeHandlers}
      data-testid="presets"
    >
      <div className={styles.presetIndicatorsWrapper}>
        {PRESET_NUMBERS.map((presetNumber) => {
          return (
            <PresetNumberIndicator
              key={presetNumber}
              presetNumber={presetNumber}
            />
          );
        })}
      </div>
      <div className={styles.presetCardsWrapper}>
        {uiState.presets.map((preset) => {
          return <PresetCard key={preset.slot_index} preset={preset} />;
        })}
      </div>
    </div>
  );
};

export default observer(Presets);
