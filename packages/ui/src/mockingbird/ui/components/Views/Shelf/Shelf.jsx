import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import AmbientBackdrop from '../AmbientBackdrop/AmbientBackdrop';
import ShelfHeader from './ShelfHeader/ShelfHeader';
import './Shelf.scss';
import { useCarThingStore } from '../../../contexts/CarThingStore';
import ShelfSwiper from './ShelfSwiper/ShelfSwiper';
import VoiceMutedBanner from './VoiceMutedBanner/VoiceMutedBanner';

const getGradientBackground = (rgbChannels) => {
  return `radial-gradient(ellipse at 100px -200px, rgb(${rgbChannels.join(
    ',',
  )}) 5%, black 60%)`;
};

const Shelf = () => {
  const { shelfStore, playerStore, ubiLogger } = useCarThingStore();

  useEffect(() => {
    shelfStore.shelfController.reset();
    shelfStore.getShelfData();
    ubiLogger.contentShelfUbiLogger.logImpression();
  }, [shelfStore, ubiLogger.contentShelfUbiLogger]);

  const uiState = shelfStore.shelfController.shelfSwiperItemUiState;
  const allShelfItems = shelfStore.shelfController.swiperUiState.allShelfItems;
  const nowPlayingItem = allShelfItems.find(item => uiState.showNowPlaying(item.uri));
  const gradientImageId = nowPlayingItem?.image_uri || nowPlayingItem?.image_id || playerStore.currentImageId;

  return (
    <>
      <AmbientBackdrop
        imageId={gradientImageId}
        getBackgroundStyleAttribute={getGradientBackground}
      />
      <div id="shelf" data-testid="shelf">
        <ShelfHeader />
        <ShelfSwiper />
        <VoiceMutedBanner />
      </div>
    </>
  );
};

export default observer(Shelf);
