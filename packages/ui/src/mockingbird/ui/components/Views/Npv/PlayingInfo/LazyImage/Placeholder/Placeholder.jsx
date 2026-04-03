import { IconPlaylist } from './icons/IconPlaylist';
import { IconTrack } from './icons/IconTrack';
import { IconAlbum } from './icons/IconAlbum';
import { IconPodcasts } from './icons/IconPodcasts';
import { IconArtist } from './icons/IconArtist';
import { IconRadio } from './icons/IconRadio';
import { parseURI, URITypeMap, isLikedSongsURI } from './uriHelpers';
import classNames from 'classnames';
import { getImageBorderRadius } from '../LazyImage';
import { useCarThingStore } from '../../../../../../contexts/CarThingStore';
import { observer } from 'mobx-react-lite';
import styles from './Placeholder.module.scss';

const Placeholder = ({ uri, size, onClick, scale = 5, isActive }) => {
  const { npvStore } = useCarThingStore();
  const uiState = npvStore.controlButtonsUiState;
  const iconSize = 30;
  const typedUri = parseURI(uri.replace('podcast', 'show'));
  let icon = <IconPlaylist iconSize={iconSize} />;

  if (isLikedSongsURI(uri)) {
    icon = <IconPlaylist iconSize={iconSize} />;
  } else if (!typedUri) {
    icon = <IconTrack iconSize={iconSize} />;
  } else {
    const type = typedUri.type;
    if (type === URITypeMap.TRACK) {
      icon = <IconTrack iconSize={iconSize} />;
    }
    if (type === URITypeMap.ALBUM) {
      icon = <IconAlbum iconSize={iconSize} />;
    }
    if (type === URITypeMap.SHOW) {
      icon = <IconPodcasts iconSize={iconSize} />;
    }
    if (type === URITypeMap.EPISODE) {
      icon = <IconPodcasts iconSize={iconSize} />;
    }
    if (type === URITypeMap.ARTIST) {
      icon = <IconArtist iconSize={iconSize} />;
    }
    if (type === URITypeMap.STATION) {
      icon = <IconRadio iconSize={iconSize} />;
    }
    if (type === URITypeMap.COLLECTION) {
      icon = <IconPlaylist iconSize={iconSize} />;
    }
  }

  return (
    <div
      className={classNames(styles.placeholder, {
        [styles.otherMedia]: !uiState.isPlayingSpotify,
      })}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderColor: isActive ? 'white' : 'rgba(255, 255, 255, 0)',
        borderRadius: getImageBorderRadius(uri, size),
      }}
      onClick={(e) => {
        if (onClick) {
          onClick(e);
        }
      }}
    >
      <div
        className={styles.placeholderIcon}
        style={{ transform: `scale(${scale})` }}
      >
        {icon}
      </div>
    </div>
  );
};

export default observer(Placeholder);
