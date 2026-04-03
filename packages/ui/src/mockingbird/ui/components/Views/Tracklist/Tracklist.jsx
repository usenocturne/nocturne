import { useEffect } from 'react';
import TracklistSwiper from './TracklistSwiper';
import { observer } from 'mobx-react-lite';
import TracklistHeader from './TracklistHeader';
import styles from './Tracklist.module.scss';
import AmbientBackdrop from '../AmbientBackdrop/AmbientBackdrop';
import { useCarThingStore } from '../../../contexts/CarThingStore';
import EmptyTracklistState from './EmptyTracklistState';
import classNames from 'classnames';
import QueueConfirmationBanner from './ActionConfirmation/QueueConfirmationBanner';

const Tracklist = () => {
  const { tracklistStore } = useCarThingStore();
  const uiState = tracklistStore.tracklistUiState;
  
  const getGradientBackground = (rgbChannels) => {
    return `linear-gradient(180deg, rgba(0, 0, 0, ${
      uiState.isSelectingFirst ? '0.8' : '1'
    }) 0%, rgba(0, 0, 0, 1) 100%), rgb(${rgbChannels.join(',')})`;
  };

  const loadingState = (
    <div className={styles.emptyBody} data-testid="loading" />
  );

  const showLoadingState = uiState.isLoading && uiState.tracksList.length === 0;
  const showEmptyState = !uiState.isLoading && uiState.tracksList.length === 0;
  const showTrackList = !showLoadingState && !showEmptyState;

  useEffect(() => {
    uiState.logContextImpression();
  }, [uiState]);

  useEffect(() => {
    return () => {
      uiState.setShouldShowAddToQueueBanner(false);
    };
  }, [uiState]);

  return (
    <>
      <AmbientBackdrop
        imageId={uiState.currentPlayingImageId}
        getBackgroundStyleAttribute={getGradientBackground}
      />
      <div
        data-testid="tracklist"
        className={classNames(styles.tracklist, {
          [styles.smallHeader]: uiState.smallHeader,
        })}
      >
        <TracklistHeader />
        {showLoadingState && loadingState}
        {showEmptyState && (
          <EmptyTracklistState contextUri={uiState.contextUri} />
        )}
        {showTrackList && <TracklistSwiper />}
      </div>
      <QueueConfirmationBanner />
    </>
  );
};

export default observer(Tracklist);
