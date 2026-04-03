import { IconVolume48, IconVolumeOff48 } from '../../../Icons/CarthingUIComponents';
import Type from '../../../CarthingUIComponents/Type/Type';
import { useCarThingStore } from '../../../../contexts/CarThingStore';
import { observer } from 'mobx-react-lite';
import styles from './Volume.module.scss';
import VolumeBar from './VolumeBar';

const Volume = () => {
  const { npvStore } = useCarThingStore();
  const uiState = npvStore.volumeUiState;

  return (
    <div className={styles.volume} data-testid="volume">
      {uiState.carMode ? (
        <>
          <Type name="canonBook" textColor="white">
            Phone volume unavailable with {uiState.carMode}
          </Type>
        </>
      ) : (
        <>
          <VolumeBar />
          <div className={styles.volumeInfo}>
            <div className={styles.volumeIcon}>
              {uiState.isVolumeAbove0 ? <IconVolume48 /> : <IconVolumeOff48 />}
            </div>
            <Type name="canonBook" textColor="white">
              Phone volume
            </Type>
          </div>
        </>
      )}
    </div>
  );
};

export default observer(Volume);
