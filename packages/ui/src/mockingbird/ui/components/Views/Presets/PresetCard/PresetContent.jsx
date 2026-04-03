import { observer } from 'mobx-react-lite';
import LazyImage from '../../Npv/PlayingInfo/LazyImage/LazyImage';
import styles from './PresetContent.module.scss';
import Type from '../../../CarthingUIComponents/Type/Type';
import NowPlaying from '../../../CarthingUIComponents/NowPlaying/NowPlaying';
import { useCarThingStore } from '../../../../contexts/CarThingStore';
import classNames from 'classnames';

const PresetContent = ({ preset }) => {
  const { presetsController } = useCarThingStore();
  const uiState = presetsController.presetsUiState;
  const isFocused = uiState.selectedPresetNumber === preset.slot_index;
  
  const isRadioStation = preset.context_uri && preset.context_uri.includes('spotify:station:');
  
  return (
    <>
      <LazyImage
        imageId={preset.image_url}
        size={168}
        uri={preset.context_uri}
        isActive={isFocused}
      />
      <div className={styles.presetTitle}>
        <Type
          name="mestroBold"
          className={styles.title}
          dataTestId={`preset-${preset.slot_index}-name`}
        >
          {isRadioStation ? `Radio · ${preset.name}` : preset.name}
        </Type>
        {uiState.showNowPlaying(preset.context_uri) ? (
          <NowPlaying playing={uiState.isPlaying} textName="mestroBook" />
        ) : (
          preset.description && (
            <Type name="mestroBook" className={styles.subtitle}>
              {preset.description}
            </Type>
          )
        )}
      </div>
    </>
  );
};

export default observer(PresetContent);