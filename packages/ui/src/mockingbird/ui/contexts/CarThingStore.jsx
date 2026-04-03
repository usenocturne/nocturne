import React, { createContext, useContext, useEffect } from 'react';
import { runInAction } from 'mobx';
import { RootStore } from '../stores/RootStore';
import { MockPersistentStorage, ErrorHandler } from '../stores/stubs';
import { useCarThingSpotifyIntegration } from '../hooks/useCarThingSpotifyIntegration';
import { sendNocturneWsRequest } from '../../../hooks/useNocturned';

const mockInterappActions = {
  getTts: (fileName) => console.log('Playing TTS:', fileName),
};

const mockMiddlewareActions = {
  onboardingGet: () => console.log('Getting onboarding status'),
  onboardingFinished: () => console.log('Onboarding finished'),
  voiceMute: (mute, force) => console.log('Voice mute:', mute),
};

const mockSocket = {
  addSocketEventListener: (callback) => {
    // Mock socket - could trigger test events here
  },
};

const mockPersistentStorage = new MockPersistentStorage();
const mockErrorHandler = new ErrorHandler();

const rootStore = new RootStore(
  mockInterappActions,
  mockMiddlewareActions,
  mockPersistentStorage,
  mockSocket,
  mockErrorHandler
);

const CarThingStoreContext = createContext(rootStore);

export const CarThingStoreProvider = ({ children, playbackProgress, onSeek, spotifyData, currentPlayback, playerControls }) => {
  useCarThingSpotifyIntegration(rootStore, currentPlayback, playerControls);

  useEffect(() => {
    runInAction(() => {
      rootStore.spotifyData = spotifyData;
    });
    // Seed shelf recents from parent data if available
    if (spotifyData?.recentAlbums?.length > 0 && rootStore.shelfStore) {
      rootStore.shelfStore.seedRecentAlbums(spotifyData.recentAlbums);
    }
  }, [spotifyData]);

  rootStore.currentPlayback = currentPlayback;
  rootStore.spotifyControls = playerControls;

  if (playerControls) {
    rootStore.tracklistStore.tracklistUiState.playTrack = playerControls.playTrack;
  }
  rootStore.tracklistStore.tracklistUiState.addToQueue = (uri) => {
    sendNocturneWsRequest('spotify.player.queue.add', { uri }, { timeoutMs: 5000 })
      .catch((err) => console.warn('Add to queue failed:', err?.message));
  };
  rootStore.tracklistStore.tracklistUiState.likeAlbumOrPlaylist = (uri, isLiked) => {
    const id = uri.split(':').pop();
    if (uri.includes('album:')) {
      console.log('Album liking not yet implemented');
    } else if (uri.includes('playlist:')) {
      console.log('Playlist following not yet implemented');
    }
  };

  const contextValue = {
    ...rootStore,
    spotifyData,
    playbackProgress,
    onSeek,
    spotifyControls: playerControls,
    currentPlayback,
  };

  return (
    <CarThingStoreContext.Provider value={contextValue}>
      {children}
    </CarThingStoreContext.Provider>
  );
};

export const useCarThingStore = () => {
  const context = useContext(CarThingStoreContext);
  if (!context) {
    throw new Error('useCarThingStore must be used within CarThingStoreProvider');
  }
  return context;
};
