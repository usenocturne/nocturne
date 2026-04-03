import { makeAutoObservable, runInAction, action } from 'mobx';
import { getShelfImageUrl, getThumbnailImageUrl } from '../helpers/ImageSizeHelper';

export const HOME_IDENTIFIER = 'featured';
export const VOICE_IDENTIFIER = 'voice';
export const YOUR_LIBRARY = 'your-library';

const MAX_RECENT_ALBUMS = 10;

class ShelfStore {
  recentAlbums = [];
  _recentAlbumsInitialized = false;

  constructor(rootStore, interappActions) {
    this.rootStore = rootStore;
    this.interappActions = interappActions;

    makeAutoObservable(this, {
      rootStore: false,
      interappActions: false,
      _recentAlbumsInitialized: false,
    });

    this.loading = false;
    this.categories = [];
    this.voiceCategoryId = undefined;
    this.shelfController = new ShelfController(this);
  }

  /**
   * Seeds the recentAlbums list from the initial API fetch.
   * Only runs once — subsequent updates come from pushCurrentAlbum.
   */
  seedRecentAlbums(albums) {
    if (this._recentAlbumsInitialized || !albums || albums.length === 0) return;
    this._recentAlbumsInitialized = true;

    // Merge: keep any already-pushed albums (e.g. currently playing) at front,
    // then append seeded albums that aren't already present
    const existingIds = new Set(this.recentAlbums.map(a => a.id));
    const merged = [...this.recentAlbums];
    for (const album of albums) {
      if (album?.id && !existingIds.has(album.id)) {
        existingIds.add(album.id);
        merged.push(album);
      }
    }
    this.recentAlbums = merged.slice(0, MAX_RECENT_ALBUMS);
  }

  /**
   * Called when the currently playing album changes.
   * Moves/inserts the album to the front of the list.
   */
  pushCurrentAlbum(album) {
    if (!album?.id) return;

    const existing = this.recentAlbums.find(a => a.id === album.id);
    const entry = existing || album;
    const updated = this.recentAlbums.filter(a => a.id !== album.id);
    updated.unshift(entry);

    // Cap at max
    this.recentAlbums = updated.slice(0, MAX_RECENT_ALBUMS);
  }

  async getShelfData() {
    if (!this.rootStore.sessionStateStore?.isLoggedIn) {
      return;
    }

    this.loading = true;
    try {
      const spotifyData = this.rootStore.spotifyData;
      if (spotifyData && !spotifyData.initialDataLoaded) {
        // hi
      }
    } catch (error) {
      console.error('Error loading shelf data:', error);
    } finally {
      this.loading = false;
    }
  }

  reset() {
    this.categories = [];
    this.voiceCategoryId = undefined;
    this.shelfController.reset();
  }
}

class ShelfHeaderUiState {
  constructor(shelfStore) {
    this.shelfStore = shelfStore;
    this.selectedCategoryId = HOME_IDENTIFIER;
    makeAutoObservable(this);
  }

  get mainCategoriesCount() { return 2; }
  get mainCategories() {
    return [
      { parsedId: HOME_IDENTIFIER, name: 'Home' },
      { parsedId: VOICE_IDENTIFIER, name: 'Voice' }
    ];
  }
  get yourLibraryCategories() {
    return [
      { parsedId: 'playlists', name: 'Playlists', id: 'playlists', title: 'Playlists' },
      { parsedId: 'podcasts', name: 'Podcasts', id: 'podcasts', title: 'Podcasts' },
      { parsedId: 'artists', name: 'Artists', id: 'artists', title: 'Artists' },
      { parsedId: 'albums', name: 'Albums', id: 'albums', title: 'Albums' }
    ];
  }

  get firstLibraryCategoryId() {
    return this.yourLibraryCategories.length > 0 ? this.yourLibraryCategories[0].parsedId : undefined;
  }
  get activeTitleIndex() {
    const yourLibraryCategoryIds = this.yourLibraryCategories.map(category => category.parsedId);
    const titleCategories = this.mainCategories
      .map(category => category.parsedId)
      .concat([YOUR_LIBRARY])
      .concat(yourLibraryCategoryIds);

    return titleCategories.findIndex(categoryId => categoryId === this.selectedCategoryId);
  }
  get isInYourLibrary() {
    return this.yourLibraryCategories.some(cat => cat.parsedId === this.selectedCategoryId);
  }

  isSelectedItemCategory(categoryId) { return categoryId === this.selectedCategoryId; }

  reset() {
    this.selectedCategoryId = HOME_IDENTIFIER;
  }

  headerItemClicked(id) {
    let targetCategoryId = id;
    if (id === YOUR_LIBRARY) {
      const firstLibraryId = this.firstLibraryCategoryId;
      if (firstLibraryId) {
        targetCategoryId = firstLibraryId;
        this.selectedCategoryId = firstLibraryId;
      }
    } else {
      this.selectedCategoryId = id;
    }

    if (this.shelfStore && this.shelfStore.rootStore && this.shelfStore.rootStore.viewStore) {
      this.shelfStore.rootStore.viewStore.showContentShelf();
    }

    this.updateToFirstItemOfCategory(targetCategoryId);
  }

  updateToFirstItemOfCategory(categoryId) {
    const swiperUiState = this.shelfStore.shelfController.swiperUiState;
    const allItems = swiperUiState.allShelfItems;
    const firstItemOfCategory = allItems.find(item => item.category === categoryId);

    if (firstItemOfCategory) {
      const itemIndex = allItems.findIndex(item =>
        item.identifier === firstItemOfCategory.identifier
      );

      if (itemIndex >= 0) {
        swiperUiState.selectedItemIndex = itemIndex;
      } else {
        // nothing
      }
    } else {
      // nothing again
    }
  }
}

class ShelfSwiperUiState {
  constructor(shelfStore) {
    this.selectedItemIndex = 0;
    this.shelfStore = shelfStore;
    this.categories = {};
    this.expandedCategories = new Set();
    this.collapseTimeouts = new Map();
    this.refreshTrigger = 0;
    this.animateSliding = false;
    makeAutoObservable(this);
  }

  get allShelfItems() {
    // Access recentAlbums to establish MobX tracking
    const recentAlbums = this.shelfStore.recentAlbums;

    const rootStore = this.shelfStore.rootStore;

    if (!rootStore.sessionStateStore?.isLoggedIn) {
      return [];
    }

    const spotifyData = rootStore.spotifyData;
    if (!spotifyData || !spotifyData.initialDataLoaded) {
      return [];
    }

    const currentTrack = rootStore.playerStore?.state?.track;
    const isPlaying = rootStore.playerStore?.state?.is_playing;

    return this.buildContinuousShelfItems(spotifyData, currentTrack, isPlaying);
  }

  buildContinuousShelfItems(spotifyData, currentTrack = null, isPlaying = false) {
    const items = [];
    const recentAlbums = this.shelfStore.recentAlbums;

    const effectiveCurrentTrack = currentTrack || this.shelfStore.rootStore.playerStore?.state?.track;
    const currentAlbumId = effectiveCurrentTrack?.album?.id;

    // Render recentAlbums in order — first item is "Now Playing" if playing
    const homeVisible = this.getCategoryVisibleCount(HOME_IDENTIFIER, 5);
    const visibleAlbums = recentAlbums.slice(0, homeVisible);

    const homeItems = visibleAlbums.map((album, index) => {
      const isCurrentlyPlaying = index === 0 && !!currentAlbumId && album.id === currentAlbumId;
      const artistNames = album.artists
        ? (Array.isArray(album.artists) ? album.artists.map(a => a.name).join(', ') : '')
        : 'Various Artists';

      return {
        type: 'CONTEXT_ITEM',
        identifier: isCurrentlyPlaying ? `current-playing-${album.id}` : `recent-${album.id}`,
        uri: album.uri,
        title: album.name,
        subtitle: artistNames,
        image_id: getShelfImageUrl(album.images) || '',
        category: HOME_IDENTIFIER,
        playable: true,
        isCurrentlyPlaying: isCurrentlyPlaying,
        isPlaying: isCurrentlyPlaying ? isPlaying : false,
      };
    });
    items.push(...homeItems);

    if (recentAlbums.length > homeVisible) {
      items.push({
        type: 'MORE_ITEM',
        identifier: 'more-home',
        category: HOME_IDENTIFIER,
        title: 'More'
      });
    }

    items.push({
      type: 'INLINE_TIP_ITEM',
      identifier: 'voice-tip',
      category: VOICE_IDENTIFIER,
      title: 'Voice results will appear here',
      subtitle: 'or tap the mic button to make a request.'
    });
    items.push({
      type: 'SPACER_ITEM',
      identifier: 'voice-tip-spacer',
      category: VOICE_IDENTIFIER
    });

    const playlistsVisible = this.getCategoryVisibleCount('playlists', 5);

    // Liked Songs as first playlist item
    if (spotifyData.likedSongs) {
      const count = spotifyData.likedSongs.tracks?.total;
      const userId = spotifyData.spotifyUserId;
      items.push({
        type: 'CONTEXT_ITEM',
        identifier: 'liked-songs',
        uri: userId ? `spotify:user:${userId}:collection` : 'spotify:collection',
        title: 'Liked Songs',
        subtitle: count ? `${count} songs` : 'Liked Songs',
        image_id: spotifyData.likedSongs.images?.[0]?.url || '/images/liked-songs.webp',
        category: 'playlists',
        playable: true,
      });
    }

    // Split DJ out of userPlaylists and pin it as second item
    const DJ_ID = '37i9dQZF1EYkqdzj48dyYq';
    const allPlaylists = spotifyData.userPlaylists || [];
    const djPlaylist = allPlaylists.find(p => p.id === DJ_ID);
    const otherPlaylists = allPlaylists.filter(p => p.id !== DJ_ID);

    if (djPlaylist) {
      items.push({
        type: 'CONTEXT_ITEM',
        identifier: 'dj-playlist',
        uri: djPlaylist.uri || `spotify:playlist:${DJ_ID}`,
        title: 'DJ',
        subtitle: '100 songs',
        image_id: getShelfImageUrl(djPlaylist.images) || '',
        category: 'playlists',
        playable: true,
        isDJ: true,
      });
    }

    if (otherPlaylists.length > 0) {
      const playlistItems = otherPlaylists.slice(0, playlistsVisible).map(playlist => ({
        type: 'CONTEXT_ITEM',
        identifier: `playlist-${playlist.id}`,
        uri: playlist.uri,
        title: playlist.name,
        subtitle: (() => {
          const count = playlist.tracks?.total ?? playlist.track_count ?? playlist.trackCount;
          return count != null ? `${count} songs` : 'Playlist';
        })(),
        image_id: getShelfImageUrl(playlist.images) || '',
        category: 'playlists',
        playable: true
      }));
      items.push(...playlistItems);

      if (otherPlaylists.length > playlistsVisible) {
        items.push({
          type: 'MORE_ITEM',
          identifier: 'more-playlists',
          category: 'playlists',
          title: 'More'
        });
      }
    } else {
      items.push({
        type: 'INLINE_TIP_ITEM',
        identifier: 'playlists-tip',
        category: 'playlists',
        title: 'You don\'t have any playlists',
        subtitle: '"Hey Spotify, like this playlist" or tap the heart icon.'
      });
      items.push({
        type: 'SPACER_ITEM',
        identifier: 'playlists-tip-spacer',
        category: 'playlists'
      });
    }

    const podcastsVisible = this.getCategoryVisibleCount('podcasts', 5);
    if (spotifyData.userShows && spotifyData.userShows.length > 0) {
      const podcastItems = spotifyData.userShows.slice(0, podcastsVisible).map(showItem => {
        const show = showItem.show || showItem;
        return {
          type: 'CONTEXT_ITEM',
          identifier: `podcast-${show.id}`,
          uri: show.uri,
          title: show.name,
          subtitle: show.publisher || show.description?.substring(0, 50) || 'Podcast',
          image_id: getShelfImageUrl(show.images) || '',
          category: 'podcasts',
          playable: true
        };
      });
      items.push(...podcastItems);

      if (spotifyData.userShows.length > podcastsVisible) {
        items.push({
          type: 'MORE_ITEM',
          identifier: 'more-podcasts',
          category: 'podcasts',
          title: 'More'
        });
      }
    } else {
      items.push({
        type: 'INLINE_TIP_ITEM',
        identifier: 'podcasts-tip',
        category: 'podcasts',
        title: 'You haven\'t followed any podcasts',
        subtitle: '"Hey Spotify, follow this podcast" or tap the heart icon.'
      });
      items.push({
        type: 'SPACER_ITEM',
        identifier: 'podcasts-tip-spacer',
        category: 'podcasts'
      });
    }

    const artistsVisible = this.getCategoryVisibleCount('artists', 5);
    if (spotifyData.topArtists && spotifyData.topArtists.length > 0) {
      const artistItems = spotifyData.topArtists.slice(0, artistsVisible).map(artist => ({
        type: 'CONTEXT_ITEM',
        identifier: `artist-${artist.id}`,
        uri: artist.uri,
        title: artist.name,
        subtitle: '',
        image_id: getShelfImageUrl(artist.images) || '',
        category: 'artists',
        playable: true
      }));
      items.push(...artistItems);

      if (spotifyData.topArtists.length > artistsVisible) {
        items.push({
          type: 'MORE_ITEM',
          identifier: 'more-artists',
          category: 'artists',
          title: 'More'
        });
      }
    } else {
      items.push({
        type: 'INLINE_TIP_ITEM',
        identifier: 'artists-tip',
        category: 'artists',
        title: 'You haven\'t followed any artists',
        subtitle: '"Hey Spotify, follow this artist" or tap the heart icon.'
      });
      items.push({
        type: 'SPACER_ITEM',
        identifier: 'artists-tip-spacer',
        category: 'artists'
      });
    }

    const albumsVisible = this.getCategoryVisibleCount('albums', 5);
    if (spotifyData.userAlbums && spotifyData.userAlbums.length > 0) {
      const albumItems = spotifyData.userAlbums.slice(0, albumsVisible).map(albumItem => {
        const album = albumItem.album || albumItem;
        return {
          type: 'CONTEXT_ITEM',
          identifier: `album-${album.id}`,
          uri: album.uri,
          title: album.name,
          subtitle: album.artists ? album.artists.map(a => a.name).join(', ') : 'Various Artists',
          image_id: getShelfImageUrl(album.images) || '',
          category: 'albums',
          playable: true
        };
      });
      items.push(...albumItems);

      if (spotifyData.userAlbums.length > albumsVisible) {
        items.push({
          type: 'MORE_ITEM',
          identifier: 'more-albums',
          category: 'albums',
          title: 'More'
        });
      }
    } else {
      items.push({
        type: 'INLINE_TIP_ITEM',
        identifier: 'albums-tip',
        category: 'albums',
        title: 'You haven\'t saved any albums',
        subtitle: '"Hey Spotify, like this album" or tap the heart icon.'
      });
    }

    return items;
  }

  getCategoryVisibleCount(categoryId, defaultVisible = 5) {
    const expandCount = this.expandedCategories.has(categoryId) ? 9 : 0;
    return defaultVisible + expandCount;
  }

  get INITIAL_VISIBLE_ITEMS() { return 5; }
  get INITIAL_VISIBLE_ITEMS_ON_VOICE() { return 9; }
  get NUMBER_OF_ITEMS_TO_SHOW_ON_MORE() { return 9; }
  get TIME_BEFORE_COLLAPSING_CATEGORY() { return 5000; }

  expandCategory(categoryId) {
    this.expandedCategories.add(categoryId);
    this.collapseOtherCategories(categoryId);
  }

  collapseOtherCategories(activeCategoryId) {
    [HOME_IDENTIFIER, VOICE_IDENTIFIER, YOUR_LIBRARY].forEach(categoryId => {
      if (categoryId !== activeCategoryId) {
        this.expandedCategories.delete(categoryId);
        this.clearCollapseTimeout(categoryId);
      }
    });
  }

  scheduleCollapse(categoryId) {
    this.clearCollapseTimeout(categoryId);

    const timeoutId = setTimeout(() => {
      this.expandedCategories.delete(categoryId);
    }, this.TIME_BEFORE_COLLAPSING_CATEGORY);

    this.collapseTimeouts.set(categoryId, timeoutId);
  }

  clearCollapseTimeout(categoryId) {
    const timeoutId = this.collapseTimeouts.get(categoryId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.collapseTimeouts.delete(categoryId);
    }
  }

  dismissBanner() { }

  handleDraggedToIndex(index) {
    this.selectedItemIndex = index;
    this.updateSelectedCategoryFromIndex(index);
    this.shelfStore.rootStore.viewStore.showContentShelf();
  }

  updateSelectedCategoryFromIndex(index) {
    const items = this.allShelfItems;
    const selectedItem = items[index];

    if (selectedItem && selectedItem.category) {
      const headerUiState = this.shelfStore.shelfController.headerUiState;
      if (headerUiState.selectedCategoryId !== selectedItem.category) {
        headerUiState.selectedCategoryId = selectedItem.category;
      }
    }
  }

  handleMoreButtonClicked(categoryId) {
    this.expandCategory(categoryId);
  }
}

class ShelfSwiperItemUiState {
  constructor(shelfStore) {
    this.shelfStore = shelfStore;
    makeAutoObservable(this);
  }

  get isDialPressed() { return false; }
  get isPlaying() {
    return this.shelfStore.rootStore.playerStore.isPlayingSpotify;
  }
  get isMicEnabled() { return true; }
  get showPushToTalk() { return true; }
  get graphQlEnabled() { return true; }

  isMoreItem(item) { return item.type === 'MORE_ITEM'; }
  isContextItem(item) { return item.type === 'CONTEXT_ITEM'; }
  isSpacerItem(item) { return item.type === 'SPACER_ITEM'; }
  isTextPlaceholder(item) { return item.type === 'TEXT_PLACEHOLDER' || item.type === 'INLINE_TIP_ITEM'; }
  isVoiceDefaultItem(item) { return item.type === 'VOICE_DEFAULT'; }
  isVoiceTextPlaceholder(item) { return item.type === 'VOICE_TEXT_PLACEHOLDER'; }
  isLeftItem(item) { return false; }
  isHidden(item) { return false; }

  artworkClicked(item) {
    if (item.type === 'CONTEXT_ITEM' && item.playable) {
      if (item.isDJ) {
        const controls = this.shelfStore.rootStore.spotifyControls;
        const playback = this.shelfStore.rootStore.currentPlayback;
        controls?.playDJMix?.(playback?.device?.id);
        setTimeout(() => {
          this.shelfStore.rootStore.viewStore.showNpv();
        }, 100);
        return;
      }
      if (item.category === 'albums' || item.category === 'playlists' || item.category === 'artists' || item.category === 'podcasts' || item.category === 'featured') {
        const contextItem = {
          uri: item.uri,
          title: item.title,
          image_id: item.image_id
        };

        this.shelfStore.rootStore.tracklistStore.tracklistUiState.initializeTracklist(contextItem);
        this.shelfStore.rootStore.viewStore.showTracklist();
      } else {
        setTimeout(() => {
          this.shelfStore.rootStore.viewStore.showNpv();
        }, 100);
      }
    }
  }
  moreButtonClicked(itemCategory) {
    const shelfStore = this.shelfStore || this.rootStore?.shelfStore;
    const swiperUiState = shelfStore?.shelfController?.swiperUiState;
    if (swiperUiState) {
      swiperUiState.handleMoreButtonClicked(itemCategory);
    }
  }
  pushToTalkClicked(item) { console.log('Push to talk:', item); }
  logContextItemImpression(uri, category) { }
  showNowPlaying(uri) {
    this.refreshTrigger;
    const currentTrack = this.shelfStore.rootStore.playerStore?.state?.track;
    if (!currentTrack || !uri) return false;
    return currentTrack.album?.uri === uri ||
      currentTrack.uri === uri ||
      currentTrack.album?.id === uri.replace('spotify:album:', '');
  }
  getcategoryItemTitle(category) { return category; }
}

class VoiceMuteBannerUiState {
  constructor() {
    makeAutoObservable(this);
  }

  get shouldShowAlert() { return false; }

  handleClickUnmute() { console.log('Unmute clicked'); }
}

class ShelfController {
  constructor(shelfStore) {
    this.shelfStore = shelfStore;
    this.selectedItem = undefined;
    this.headerUiState = new ShelfHeaderUiState(shelfStore);
    this.swiperUiState = new ShelfSwiperUiState(shelfStore);
    this.shelfSwiperItemUiState = new ShelfSwiperItemUiState(shelfStore);
    this.voiceMuteBannerUiState = new VoiceMuteBannerUiState();

    makeAutoObservable(this, {
      shelfStore: false,
    });
  }

  goBackToHome() {
  }

  handleBackButton() {
    this.shelfStore.rootStore.viewStore.back();
  }

  handleDialPress() {
    const swiperUiState = this.swiperUiState;
    const allItems = swiperUiState.allShelfItems;
    const selectedIndex = swiperUiState.selectedItemIndex;
    const selectedItem = allItems[selectedIndex];

    if (selectedItem) {
      if (selectedItem.type === 'MORE_ITEM') {
        swiperUiState.handleMoreButtonClicked(selectedItem.category);
      } else if (selectedItem.type === 'CONTEXT_ITEM' && selectedItem.playable) {
        if (selectedItem.isDJ) {
          const controls = this.shelfStore.rootStore.spotifyControls;
          const playback = this.shelfStore.rootStore.currentPlayback;
          controls?.playDJMix?.(playback?.device?.id);
          setTimeout(() => {
            this.shelfStore.rootStore.viewStore.showNpv();
          }, 100);
        } else if (selectedItem.category === 'albums' || selectedItem.category === 'playlists' || selectedItem.category === 'artists' || selectedItem.category === 'podcasts' || selectedItem.category === 'featured') {
          const contextItem = {
            uri: selectedItem.uri,
            title: selectedItem.title,
            image_id: selectedItem.image_id
          };

          this.shelfStore.rootStore.tracklistStore.tracklistUiState.initializeTracklist(contextItem);
          this.shelfStore.rootStore.viewStore.showTracklist();
        } else {
          this.shelfSwiperItemUiState.artworkClicked(selectedItem);

          setTimeout(() => {
            this.shelfStore.rootStore.viewStore.showNpv();
          }, 100);
        }
      }
    } else {
      // nothing
    }
  }

  handleDialLeft() {
    const swiperUiState = this.swiperUiState;
    const currentIndex = swiperUiState.selectedItemIndex;
    const allItems = swiperUiState.allShelfItems;

    if (currentIndex > 0) {
      const newIndex = currentIndex - 1;

      swiperUiState.animateSliding = true;
      swiperUiState.selectedItemIndex = newIndex;
      swiperUiState.updateSelectedCategoryFromIndex(newIndex);

      this.shelfStore.rootStore.viewStore.showContentShelf();
    } else {
      // return
    }
  }

  handleDialRight() {
    const swiperUiState = this.swiperUiState;
    const currentIndex = swiperUiState.selectedItemIndex;
    const allItems = swiperUiState.allShelfItems;
    const maxIndex = allItems.length - 1;

    if (currentIndex < maxIndex) {
      const newIndex = currentIndex + 1;

      swiperUiState.animateSliding = true;
      swiperUiState.selectedItemIndex = newIndex;
      swiperUiState.updateSelectedCategoryFromIndex(newIndex);

      this.shelfStore.rootStore.viewStore.showContentShelf();
    } else {
      // nothing
    }
  }

  reset() {
    this.selectedItem = undefined;
    this.headerUiState.reset();
    this.swiperUiState.selectedItemIndex = 0;
  }
}

export default ShelfStore;