import { observer } from 'mobx-react-lite';
import { useCarThingStore } from '../../../../contexts/CarThingStore';
import { Banner } from '../../../CarthingUIComponents';
import IconCheck32 from '../../../Icons/CarthingUIComponents/IconCheck32';

const QueueConfirmationBanner = () => {
  const { tracklistStore } = useCarThingStore();
  const uiState = tracklistStore.tracklistUiState;
  
  return (
    <Banner
      show={uiState.shouldShowQueueConfirmation}
      icon={<IconCheck32 />}
      infoText="Added to Queue."
      colorStyle="confirmation"
    />
  );
};

export default observer(QueueConfirmationBanner);