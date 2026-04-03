import { makeAutoObservable, get, action } from 'mobx';

export const PRESET_NUMBERS = [1, 2, 3, 4];

export class PresetsUiState {
  presetsDataStore;
  presetsUbiLogger;
  overlayController;
  playerStore;
  shelfStore;
  queueStore;
  viewStore;
  npvStore;
  interappActions;

  selectedPresetNumber = 1;
  isShowingPresets = false;
  isAnimatingOut = false;
  presetsTimeout = null;
  currentlyPlayingContextUri = null;

  constructor(
    presetsDataStore,
    presetsUbiLogger,
    overlayController,
    playerStore,
    shelfStore,
    queueStore,
    viewStore,
    npvStore,
    interappActions,
  ) {
    this.presetsDataStore = presetsDataStore;
    this.presetsUbiLogger = presetsUbiLogger;
    this.overlayController = overlayController;
    this.playerStore = playerStore;
    this.shelfStore = shelfStore;
    this.queueStore = queueStore;
    this.viewStore = viewStore;
    this.npvStore = npvStore;
    this.interappActions = interappActions;

    makeAutoObservable(this, {
      presetsDataStore: false,
      presetsUbiLogger: false,
      overlayController: false,
      playerStore: false,
      shelfStore: false,
      queueStore: false,
      viewStore: false,
      npvStore: false,
      interappActions: false,
    });
  }

  get currentIsPresets() {
    return this.isShowingPresets && !this.isAnimatingOut;
  }

  get presets() {
    return PRESET_NUMBERS.map(number => {
      const preset = this.presetsDataStore.getPreset(number);

      if (preset) {
        return { ...preset, slot_index: number, type: 'preset' };
      }

      return { slot_index: number, type: 'placeholder' };
    });
  }

  get isPlaying() {
    return this.playerStore.isPlayingSpotify;
  }

  showNowPlaying(contextUri) {
    if (!this.isPlaying) return false;

    const isLikedSongs = contextUri === 'spotify:collection:your-music';

    // If we have a locally tracked URI (set immediately on preset play),
    // use it exclusively to avoid stale currentPlayback showing two presets
    if (this.currentlyPlayingContextUri) {
      if (this.currentlyPlayingContextUri === contextUri) return true;
      if (isLikedSongs && this.currentlyPlayingContextUri.includes(':collection')) return true;
      return false;
    }

    // No local tracking — fall back to what Spotify reports
    const rootStore = window.carThingRootStore;
    const activeContextUri = rootStore?.currentPlayback?.context?.uri;
    if (activeContextUri) {
      if (activeContextUri === contextUri) return true;
      if (isLikedSongs && activeContextUri.includes(':collection')) return true;
    }

    return this.playerStore.contextUri === contextUri;
  }

  handlePresetButtonPress(presetNumber) {
    this.presetsUbiLogger?.logPresetButtonPressed?.(presetNumber);
    this.selectedPresetNumber = presetNumber;
    this.showPresets();
    this.loadPreset(presetNumber);
  }

  handlePresetButtonLongPress(presetNumber) {
    this.presetsUbiLogger?.logPresetButtonLongPressed?.(presetNumber);
    this.selectedPresetNumber = presetNumber;
    this.showPresets();
    this.saveCurrentContextToPreset(presetNumber);
  }

  handleTapOnPreset(presetNumber) {
    this.presetsUbiLogger?.logPresetCardTapped?.(presetNumber);
    this.loadPreset(presetNumber);
  }

  handleDialPress() {
    this.handleTapOnPreset(this.selectedPresetNumber);
  }

  handleDialLeft() {
    if (this.selectedPresetNumber > 1) {
      this.selectedPresetNumber = this.selectedPresetNumber - 1;
    }
  }

  handleDialRight() {
    if (this.selectedPresetNumber < 4) {
      this.selectedPresetNumber = this.selectedPresetNumber + 1;
    }
  }

  handleSwipeUp() {
    this.hidePresets();
  }

  loadPreset(presetNumber) {
    const preset = this.presetsDataStore.getPreset(presetNumber);

    if (!preset) {
      this.playTTS('no_presets');
      return;
    }

    if (this.presetsDataStore.isUnavailable(presetNumber)) {
      this.playTTS('preset_unavailable');
      return;
    }

    this.playPresetContext(preset);
  }

  async saveCurrentContextToPreset(presetNumber) {
    const currentUri = this.getCurrentSaveableUri();

    if (!currentUri) {
      return;
    }

    const contextData = await this.getContextData(currentUri);
    await this.presetsDataStore.savePreset(currentUri, presetNumber, 'car_thing', contextData);
  }

  getCurrentSaveableUri() {
    const rootStore = window.carThingRootStore;
    const currentPlayback = rootStore?.currentPlayback;

    if (currentPlayback) {
      const contextUri = currentPlayback.context?.uri;
      const trackUri = currentPlayback.item?.uri;
      const albumUri = currentPlayback.item?.album?.uri;

      if (contextUri && contextUri.startsWith('spotify:search')) {
        return trackUri;
      }

      if (!contextUri || contextUri.includes('queue')) {
        return albumUri || trackUri;
      }

      return contextUri || albumUri || trackUri;
    }

    const contextUri = this.playerStore.contextUri;
    const trackUri = this.playerStore.currentTrack?.uri;
    const albumUri = this.playerStore.currentTrack?.album?.uri;

    if (contextUri && contextUri.startsWith('spotify:search')) {
      return trackUri;
    }

    if (!contextUri || contextUri.includes('queue')) {
      return albumUri || trackUri;
    }

    return contextUri && contextUri !== 'spotify:track:unknown' ? contextUri : (albumUri || trackUri);
  }

  async getContextData(uri) {
    const rootStore = window.carThingRootStore;
    const currentPlayback = rootStore?.currentPlayback;
    const npvUiState = rootStore?.npvStore?.playingInfoUiState;

    let contextName = 'Unknown';
    let contextDescription = '';
    let contextImage = currentPlayback?.item?.album?.images?.[0]?.url || '';

    if (uri.includes('spotify:artist:')) {
      contextName = currentPlayback?.item?.artists?.[0]?.name || 'Unknown Artist';
      contextDescription = 'Artist';
      // Try to get artist image via nocturned
      try {
        const artistId = uri.replace('spotify:artist:', '');
        const { sendNocturneWsRequest } = await import('../../../hooks/useNocturned');
        const result = await sendNocturneWsRequest('spotify.artist.get', { id: artistId }, { timeoutMs: 5000 });
        if (result?.images?.[0]?.url) contextImage = result.images[0].url;
        if (result?.name) contextName = result.name;
      } catch { /* use fallback */ }

    } else if (uri.includes('spotify:playlist:')) {
      const playlistId = uri.replace('spotify:playlist:', '');
      if (playlistId === '37i9dQZF1EYkqdzj48dyYq') {
        contextName = 'DJ';
        contextDescription = 'Spotify';
      } else {
        contextName = npvUiState?.contextHeaderTitle || 'Unknown Playlist';
        contextDescription = 'Playlist';
      }
      // Try to get playlist image via nocturned
      try {
        const { sendNocturneWsRequest } = await import('../../../hooks/useNocturned');
        const result = await sendNocturneWsRequest('spotify.playlist.get', { id: playlistId, fields: 'name,images' }, { timeoutMs: 5000 });
        if (result?.images?.[0]?.url) contextImage = result.images[0].url;
        if (result?.name) contextName = result.name;
      } catch { /* use fallback */ }

    } else if (uri.includes('spotify:album:')) {
      contextName = currentPlayback?.item?.album?.name ||
        (npvUiState?.contextHeaderTitle !== 'Queue' ? npvUiState?.contextHeaderTitle : null) ||
        'Unknown Album';
      contextDescription = currentPlayback?.item?.artists ?
        currentPlayback.item.artists.map(a => a.name).join(', ') : '';

    } else if (uri.includes('spotify:track:')) {
      contextName = currentPlayback?.item?.name || 'Unknown Track';
      contextDescription = currentPlayback?.item?.artists ?
        currentPlayback.item.artists.map(a => a.name).join(', ') : '';

    } else if (uri.includes('spotify:show:') || uri.includes('spotify:episode:')) {
      contextName = currentPlayback?.item?.show?.name || currentPlayback?.item?.name || 'Unknown';
      contextDescription = 'Podcast';
      contextImage = currentPlayback?.item?.images?.[0]?.url || contextImage;

    } else {
      contextName = npvUiState?.contextHeaderTitle || currentPlayback?.item?.name || 'Unknown';
      contextDescription = currentPlayback?.item?.artists ?
        currentPlayback.item.artists.map(a => a.name).join(', ') : '';
    }

    return {
      context_uri: uri,
      name: contextName,
      description: contextDescription,
      image_url: contextImage,
    };
  }

  showSaveError() {
    this.overlayController?.showModal?.('saving_preset_failed');
  }

  playTTS(audioType) {
    console.log(`Playing TTS: ${audioType}`);
  }

  async playPresetContext(preset) {
    // Clear previous before setting new so only one preset shows "Now Playing"
    this.currentlyPlayingContextUri = null;
    this.currentlyPlayingContextUri = preset.context_uri;
    this.playerStore.setContextUri(preset.context_uri);

    const rootStore = window.carThingRootStore;
    const playTrack = rootStore?.spotifyControls?.playTrack;

    if (!playTrack) {
      console.error('playTrack not available on spotifyControls');
      this.currentlyPlayingContextUri = null;
      return;
    }

    try {
      const uri = preset.context_uri;

      if (uri === 'spotify:collection:your-music') {
        // Liked Songs isn't a valid context_uri — use the Spotify user collection URI
        const { sendNocturneWsRequest } = await import('../../../hooks/useNocturned');
        try {
          const profile = await sendNocturneWsRequest('spotify.me.profile', {}, { timeoutMs: 5000 });
          const userId = profile?.id;
          if (userId) {
            await playTrack(null, `spotify:user:${userId}:collection`);
          } else {
            // Fallback: fetch liked tracks and play as uris
            const result = await sendNocturneWsRequest('spotify.me.tracks', { limit: 50, mockingbird: true }, { timeoutMs: 8000 });
            const trackUris = (result?.items || []).map(i => i.track?.uri).filter(Boolean);
            if (trackUris.length > 0) {
              await playTrack(trackUris[0], null, trackUris);
            }
          }
        } catch (e) {
          console.error('Error playing Liked Songs:', e);
          this.currentlyPlayingContextUri = null;
          return;
        }
      } else if (uri === 'spotify:playlist:37i9dQZF1EYkqdzj48dyYq') {
        const playDJMix = rootStore?.spotifyControls?.playDJMix;
        const deviceId = rootStore?.currentPlayback?.device?.id;
        if (playDJMix) {
          await playDJMix(deviceId);
        } else {
          await playTrack(null, uri);
        }
      } else if (uri.includes('spotify:track:')) {
        await playTrack(uri);
      } else {
        await playTrack(null, uri);
      }

      this.viewStore.showNpv();
    } catch (error) {
      console.error('Error playing preset:', error);
      this.currentlyPlayingContextUri = null;
    }
  }

  showPresets() {
    this.isShowingPresets = true;

    if (this.presetsTimeout) {
      clearTimeout(this.presetsTimeout);
    }

    this.presetsTimeout = setTimeout(action(() => {
      this.hidePresets();
    }), 4000);
  }

  hidePresets() {
    this.isAnimatingOut = true;

    setTimeout(action(() => {
      this.isShowingPresets = false;
      this.isAnimatingOut = false;
    }), 500);
  }

  reset() {
    this.selectedPresetNumber = 1;
    this.isShowingPresets = false;
    this.tempPreset = null;
  }

  logPresetsImpression() {
    this.presetsUbiLogger?.logImpression?.();
  }
}

export class PresetsDataStore {
  presets = {};
  unavailablePresets = new Set();

  constructor() {
    makeAutoObservable(this);
    this.loadPresetsFromStorage();
  }

  getPreset(presetNumber) {
    return this.presets[presetNumber];
  }

  isUnavailable(presetNumber) {
    return this.unavailablePresets.has(presetNumber);
  }

  async savePreset(uri, slotIndex, source, tempPresetData) {
    try {
      const presetData = {
        context_uri: uri,
        slot_index: slotIndex,
        name: tempPresetData?.name || 'Saved Preset',
        description: tempPresetData?.description || '',
        image_url: tempPresetData?.image_url || '',
      };

      this.presets[slotIndex] = presetData;
      this.savePresetsToStorage();
      return true;
    } catch (error) {
      console.error('Failed to save preset:', error);
      throw error;
    }
  }

  loadPresetsFromStorage() {
    try {
      const stored = localStorage.getItem('nocturne_presets');
      if (stored) {
        this.presets = JSON.parse(stored);
        this.refreshPresetImages();
      } else {
        this.setDefaultPresets();
      }
    } catch (error) {
      console.error('Error loading presets from localStorage:', error);
      this.setDefaultPresets();
    }
  }

  setDefaultPresets() {
    this.presets = {
      1: {
        context_uri: 'spotify:collection:your-music',
        name: 'Liked Songs',
        description: '',
        image_url: '/images/liked-songs.webp'
      },
      3: {
        context_uri: 'spotify:playlist:37i9dQZF1EfYtRPpxPqlEQ',
        name: 'Daily Drive',
        description: 'Spotify',
        image_url: ''
      },
    };

    this.savePresetsToStorage();
    this.refreshPresetImages();
  }

  async refreshPresetImages() {
    try {
      const { sendNocturneWsRequest } = await import('../../../hooks/useNocturned');
      for (const [slotIndex, preset] of Object.entries(this.presets)) {
        if (preset.image_url || !preset.context_uri) continue;
        const uri = preset.context_uri;
        if (uri.includes('spotify:playlist:')) {
          const playlistId = uri.replace('spotify:playlist:', '');
          try {
            const result = await sendNocturneWsRequest('spotify.playlist.get', { id: playlistId, fields: 'name,images' }, { timeoutMs: 5000 });
            if (result?.images?.[0]?.url) {
              this.presets[slotIndex] = { ...preset, image_url: result.images[0].url };
              if (result.name) this.presets[slotIndex].name = result.name;
            }
          } catch { /* skip */ }
        }
      }
      this.savePresetsToStorage();
    } catch { /* skip */ }
  }

  savePresetsToStorage() {
    try {
      localStorage.setItem('nocturne_presets', JSON.stringify(this.presets));
    } catch (error) {
      console.error('Error saving presets to localStorage:', error);
    }
  }

  loadPresets() {
    // In real implementation this would call InterappActions
    return Promise.resolve();
  }


  reset() {
    this.presets = {};
    this.unavailablePresets.clear();
  }
}

export class PresetsController {
  rootStore;
  interappActions;
  presetsUiState;

  constructor(rootStore, interappActions) {
    this.rootStore = rootStore;
    this.interappActions = interappActions;
    this.presetsUiState = new PresetsUiState(
      rootStore.presetsDataStore,
      rootStore.ubiLogger?.presetsUbiLogger,
      rootStore.overlayController,
      rootStore.playerStore,
      rootStore.shelfStore,
      rootStore.queueStore,
      rootStore.viewStore,
      rootStore.npvStore,
      rootStore.interappActions,
    );

    makeAutoObservable(this, {
      rootStore: false,
      interappActions: false,
      presetsUiState: false,
    });
  }

  get isPresetButtonsEnabled() {
    return true;
  }

  get isSwipeDownPresetsEnabled() {
    return (
      this.isPresetButtonsEnabled &&
      !this.rootStore.overlayController?.isShowing?.('voice')
    );
  }

  reset() {
    this.presetsUiState.reset();
  }
}

export default PresetsController;