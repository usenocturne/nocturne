import { observer } from 'mobx-react-lite';
import styles from './Queue.module.scss';
import { useCarThingStore } from '../../../contexts/CarThingStore';
import classNames from 'classnames';
import QueueSwiper from './QueueSwiper/QueueSwiper';
import QueueHeader from './QueueHeader/QueueHeader';
import AmbientBackdrop from '../AmbientBackdrop/AmbientBackdrop';
import { useEffect } from 'react';
import EmptyQueueState from './QueueEmptyState/EmptyQueueState';

const Queue = () => {
  const { queueStore } = useCarThingStore();
  const uiState = queueStore.queueUiState;
  
  const getGradientBackground = (rgbChannels) => {
    return `linear-gradient(180deg, rgba(0, 0, 0, ${
      uiState.showGradientBackground ? '0.8' : '1'
    }) 0%, rgba(0, 0, 0, 1) 100%), rgb(${rgbChannels.join(',')})`;
  };
  
  useEffect(() => {
    uiState.resetDialDown();
  }, [uiState]);
  
  useEffect(() => {
    uiState.logQueueImpression();
  }, [uiState]);
  
  return (
    <>
      <AmbientBackdrop
        imageId={uiState.currentPlayingImageId}
        getBackgroundStyleAttribute={getGradientBackground}
      />
      <div
        data-testid="queue"
        className={classNames(styles.queue, {
          [styles.smallHeader]: uiState.shouldShowSmallHeader,
        })}
      >
        <QueueHeader />
        {uiState.isEmptyQueue ? <EmptyQueueState /> : <QueueSwiper />}
      </div>
    </>
  );
};

export default observer(Queue);