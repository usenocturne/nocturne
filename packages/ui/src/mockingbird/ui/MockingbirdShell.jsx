import React, { useState, useEffect, useRef, useCallback } from "react";
import { runInAction } from "mobx";
import { CarThingStoreProvider } from "./contexts/CarThingStore";
import Main from "./components/Main";
import Settings from "./components/Settings/Settings";
import { sendNocturneWsRequest } from "../../hooks/useNocturned";
import "./styles/MockingbirdShell.scss";

const LazySetup = React.lazy(() => import("./components/Setup/Setup"));
const LazyOnboarding = React.lazy(
  () => import("./components/Onboarding/Onboarding"),
);

const mockingbirdFontStyles = `
@font-face {
  font-family: spotify-circular;
  src: url('/fonts/CircularSpUIv3T-Book.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  unicode-range: U+0000-2BFF, U+2E00-2E7F, U+FB00-FB06, U+FE20-FE2F, U+FEFF, U+FFFD;
}
@font-face {
  font-family: spotify-circular;
  src: url('/fonts/CircularSpUIv3T-Bold.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  unicode-range: U+0000-2BFF, U+2E00-2E7F, U+FB00-FB06, U+FE20-FE2F, U+FEFF, U+FFFD;
}
@font-face {
  font-family: spotify-circular;
  src: url('/fonts/CircularSpUIv3T-Black.woff2') format('woff2');
  font-weight: 900;
  font-style: normal;
  unicode-range: U+0000-2BFF, U+2E00-2E7F, U+FB00-FB06, U+FE20-FE2F, U+FEFF, U+FFFD;
}
@font-face {
  font-family: spotify-circular;
  src: url('/fonts/CircularSp-Arab-Book.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  unicode-range: U+0600-06FF, U+0750-077F, U+0870-089F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF;
}
@font-face {
  font-family: spotify-circular;
  src: url('/fonts/CircularSp-Arab-Bold.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  unicode-range: U+0600-06FF, U+0750-077F, U+0870-089F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF;
}
@font-face {
  font-family: spotify-circular;
  src: url('/fonts/CircularSp-Arab-Black.woff2') format('woff2');
  font-weight: 900;
  font-style: normal;
  unicode-range: U+0600-06FF, U+0750-077F, U+0870-089F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF;
}
@font-face {
  font-family: spotify-circular;
  src: url('/fonts/CircularSp-Cyrl-Book.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  unicode-range: U+0400-04FF, U+0500-052F, U+1C80-1C8F, U+2DE0-2DFF, U+A640-A69F;
}
@font-face {
  font-family: spotify-circular;
  src: url('/fonts/CircularSp-Cyrl-Bold.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  unicode-range: U+0400-04FF, U+0500-052F, U+1C80-1C8F, U+2DE0-2DFF, U+A640-A69F;
}
@font-face {
  font-family: spotify-circular;
  src: url('/fonts/CircularSp-Cyrl-Black.woff2') format('woff2');
  font-weight: 900;
  font-style: normal;
  unicode-range: U+0400-04FF, U+0500-052F, U+1C80-1C8F, U+2DE0-2DFF, U+A640-A69F;
}
@font-face {
  font-family: spotify-circular;
  src: url('/fonts/CircularSp-Deva-Book.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  unicode-range: U+0900-097F, U+1CD0-1CFF, U+A8E0-A8FF;
}
@font-face {
  font-family: spotify-circular;
  src: url('/fonts/CircularSp-Deva-Bold.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  unicode-range: U+0900-097F, U+1CD0-1CFF, U+A8E0-A8FF;
}
@font-face {
  font-family: spotify-circular;
  src: url('/fonts/CircularSp-Deva-Black.woff2') format('woff2');
  font-weight: 900;
  font-style: normal;
  unicode-range: U+0900-097F, U+1CD0-1CFF, U+A8E0-A8FF;
}
@font-face {
  font-family: spotify-circular;
  src: url('/fonts/CircularSp-Grek-Book.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  unicode-range: U+0370-03FF, U+1F00-1FFF;
}
@font-face {
  font-family: spotify-circular;
  src: url('/fonts/CircularSp-Grek-Bold.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  unicode-range: U+0370-03FF, U+1F00-1FFF;
}
@font-face {
  font-family: spotify-circular;
  src: url('/fonts/CircularSp-Grek-Black.woff2') format('woff2');
  font-weight: 900;
  font-style: normal;
  unicode-range: U+0370-03FF, U+1F00-1FFF;
}
@font-face {
  font-family: spotify-circular;
  src: url('/fonts/CircularSp-Hebr-Book.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  unicode-range: U+0590-05FF, U+FB1D-FB4F;
}
@font-face {
  font-family: spotify-circular;
  src: url('/fonts/CircularSp-Hebr-Bold.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  unicode-range: U+0590-05FF, U+FB1D-FB4F;
}
@font-face {
  font-family: spotify-circular;
  src: url('/fonts/CircularSp-Hebr-Black.woff2') format('woff2');
  font-weight: 900;
  font-style: normal;
  unicode-range: U+0590-05FF, U+FB1D-FB4F;
}
@font-face {
  font-family: spotify-circular;
  src: url('/fonts/NotoSansJP-VF.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  unicode-range: U+3040-309F, U+30A0-30FF, U+31F0-31FF, U+FF65-FF9F, U+1B000-1B0FF;
}
@font-face {
  font-family: spotify-circular;
  src: url('/fonts/NotoSansJP-VF.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  unicode-range: U+3040-309F, U+30A0-30FF, U+31F0-31FF, U+FF65-FF9F, U+1B000-1B0FF;
}
@font-face {
  font-family: spotify-circular;
  src: url('/fonts/NotoSansJP-VF.woff2') format('woff2');
  font-weight: 900;
  font-style: normal;
  unicode-range: U+3040-309F, U+30A0-30FF, U+31F0-31FF, U+FF65-FF9F, U+1B000-1B0FF;
}
@font-face {
  font-family: spotify-circular;
  src: url('/fonts/NotoSansKR-VF.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  unicode-range: U+1100-11FF, U+3130-318F, U+A960-A97F, U+AC00-D7AF, U+D7B0-D7FF;
}
@font-face {
  font-family: spotify-circular;
  src: url('/fonts/NotoSansKR-VF.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  unicode-range: U+1100-11FF, U+3130-318F, U+A960-A97F, U+AC00-D7AF, U+D7B0-D7FF;
}
@font-face {
  font-family: spotify-circular;
  src: url('/fonts/NotoSansKR-VF.woff2') format('woff2');
  font-weight: 900;
  font-style: normal;
  unicode-range: U+1100-11FF, U+3130-318F, U+A960-A97F, U+AC00-D7AF, U+D7B0-D7FF;
}
@font-face {
  font-family: spotify-circular;
  src: url('/fonts/NotoSansSC-VF.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  unicode-range: U+2E80-2EFF, U+3000-303F, U+3200-32FF, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FE30-FE4F, U+20000-2A6DF, U+2A700-2B73F, U+2B740-2B81F;
}
@font-face {
  font-family: spotify-circular;
  src: url('/fonts/NotoSansSC-VF.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  unicode-range: U+2E80-2EFF, U+3000-303F, U+3200-32FF, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FE30-FE4F, U+20000-2A6DF, U+2A700-2B73F, U+2B740-2B81F;
}
@font-face {
  font-family: spotify-circular;
  src: url('/fonts/NotoSansSC-VF.woff2') format('woff2');
  font-weight: 900;
  font-style: normal;
  unicode-range: U+2E80-2EFF, U+3000-303F, U+3200-32FF, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FE30-FE4F, U+20000-2A6DF, U+2A700-2B73F, U+2B740-2B81F;
}

`;

function usePlaybackPolling(parentPlayback) {
  const [localPlayback, setLocalPlayback] = useState(null);
  const pollingRef = useRef(null);
  const stoppedRef = useRef(false);

  const poll = useCallback(async () => {
    try {
      const data = await sendNocturneWsRequest(
        "spotify.player.state",
        {},
        { timeoutMs: 5000 },
      );
      if (data && data.item && !stoppedRef.current) {
        setLocalPlayback(data);
      }
    } catch (e) {}
    if (!stoppedRef.current) {
      pollingRef.current = setTimeout(poll, 3000);
    }
  }, []);

  useEffect(() => {
    if (parentPlayback) {
      stoppedRef.current = true;
      if (pollingRef.current) {
        clearTimeout(pollingRef.current);
        pollingRef.current = null;
      }
      setLocalPlayback(null);
      return;
    }

    stoppedRef.current = false;
    pollingRef.current = setTimeout(poll, 1500);

    return () => {
      stoppedRef.current = true;
      if (pollingRef.current) {
        clearTimeout(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [parentPlayback, poll]);

  return parentPlayback || localPlayback;
}

function parseRecentAlbums(recentRaw) {
  const recentAlbums = [];
  const seenAlbumIds = new Set();

  if (recentRaw?.albums && Array.isArray(recentRaw.albums)) {
    for (const album of recentRaw.albums) {
      if (album && album.id && !seenAlbumIds.has(album.id)) {
        seenAlbumIds.add(album.id);
        recentAlbums.push(album);
      }
    }
    return recentAlbums;
  }

  const recentItems = recentRaw?.items || recentRaw || [];
  for (const item of Array.isArray(recentItems) ? recentItems : []) {
    const track = item.track || item;
    const album = track?.album;
    if (album && album.id && !seenAlbumIds.has(album.id)) {
      seenAlbumIds.add(album.id);
      recentAlbums.push(album);
    }
  }
  return recentAlbums;
}

function useSpotifyData() {
  const [data, setData] = useState(null);
  const loaded = data?.initialDataLoaded;

  useEffect(() => {
    if (loaded) return;

    let cancelled = false;
    let retryTimer = null;
    let attempts = 0;
    const MAX_ATTEMPTS = 6;

    const FALLBACK_RECENTS = [
      {
        id: "4m2880jivSbbyEGAKfITCa",
        uri: "spotify:album:4m2880jivSbbyEGAKfITCa",
        name: "Random Access Memories",
        artists: [
          {
            id: "4tZwfgrHOc3mvqYlEYSvVi",
            name: "Daft Punk",
            type: "artist",
            uri: "spotify:artist:4tZwfgrHOc3mvqYlEYSvVi",
          },
        ],
        images: [
          {
            url: "https://i.scdn.co/image/ab67616d00001e029b9b36b0e22870b9f542d937",
          },
        ],
      },
      {
        id: "7xl50xr9NDkd3i2kBbzsNZ",
        uri: "spotify:album:7xl50xr9NDkd3i2kBbzsNZ",
        name: "Stadium Arcadium",
        artists: [
          {
            id: "0L8ExT028jH3ddEcZwqJJ5",
            name: "Red Hot Chili Peppers",
            type: "artist",
            uri: "spotify:artist:0L8ExT028jH3ddEcZwqJJ5",
          },
        ],
        images: [
          {
            url: "https://i.scdn.co/image/ab67616d00001e0209fd83d32aee93dceba78517",
          },
        ],
      },
      {
        id: "78bpIziExqiI9qztvNFlQu",
        uri: "spotify:album:78bpIziExqiI9qztvNFlQu",
        name: "AM",
        artists: [
          {
            id: "7Ln80lUS6He07XvHI8qqHH",
            name: "Arctic Monkeys",
            type: "artist",
            uri: "spotify:artist:7Ln80lUS6He07XvHI8qqHH",
          },
        ],
        images: [
          {
            url: "https://i.scdn.co/image/ab67616d00001e024ae1c4c5c45aabe565499163",
          },
        ],
      },
      {
        id: "0bQglEvsHphrS19FGODEGo",
        uri: "spotify:album:0bQglEvsHphrS19FGODEGo",
        name: "Siamese Dream (Deluxe Edition)",
        artists: [
          {
            id: "40Yq4vzPs9VNUrIBG5Jr2i",
            name: "The Smashing Pumpkins",
            type: "artist",
            uri: "spotify:artist:40Yq4vzPs9VNUrIBG5Jr2i",
          },
        ],
        images: [
          {
            url: "https://i.scdn.co/image/ab67616d00001e025274788f34fc7656d2856dfd",
          },
        ],
      },
      {
        id: "0bCAjiUamIFqKJsekOYuRw",
        uri: "spotify:album:0bCAjiUamIFqKJsekOYuRw",
        name: "Wish You Were Here",
        artists: [
          {
            id: "0k17h0D3J5VfsdmQ1iZtE9",
            name: "Pink Floyd",
            type: "artist",
            uri: "spotify:artist:0k17h0D3J5VfsdmQ1iZtE9",
          },
        ],
        images: [
          {
            url: "https://i.scdn.co/image/ab67616d00001e02828e52cfb7bf22869349799e",
          },
        ],
      },
      {
        id: "2ODvWsOgouMbaA5xf0RkJe",
        uri: "spotify:album:2ODvWsOgouMbaA5xf0RkJe",
        name: "Starboy",
        artists: [
          {
            id: "1Xyo4u8uXC1ZmMpatF05PJ",
            name: "The Weeknd",
            type: "artist",
            uri: "spotify:artist:1Xyo4u8uXC1ZmMpatF05PJ",
          },
          {
            id: "4tZwfgrHOc3mvqYlEYSvVi",
            name: "Daft Punk",
            type: "artist",
            uri: "spotify:artist:4tZwfgrHOc3mvqYlEYSvVi",
          },
        ],
        images: [
          {
            url: "https://i.scdn.co/image/ab67616d00001e024718e2b124f79258be7bc452",
          },
        ],
      },
      {
        id: "2IdHrETl3jsOYQRsF0nV16",
        uri: "spotify:album:2IdHrETl3jsOYQRsF0nV16",
        name: "Midnight Sun",
        artists: [
          {
            id: "1Xylc3o4UrD53lo9CvFvVg",
            name: "Zara Larsson",
            type: "artist",
            uri: "spotify:artist:1Xylc3o4UrD53lo9CvFvVg",
          },
        ],
        images: [
          {
            url: "https://i.scdn.co/image/ab67616d00001e027657f9028ea8bb2c18dca99f",
          },
        ],
      },
      {
        id: "55RhFRyQFihIyGf61MgcfV",
        uri: "spotify:album:55RhFRyQFihIyGf61MgcfV",
        name: "Mellon Collie And The Infinite Sadness (Deluxe Edition)",
        artists: [
          {
            id: "40Yq4vzPs9VNUrIBG5Jr2i",
            name: "The Smashing Pumpkins",
            type: "artist",
            uri: "spotify:artist:40Yq4vzPs9VNUrIBG5Jr2i",
          },
        ],
        images: [
          {
            url: "https://i.scdn.co/image/ab67616d00001e02431ac6e6f393acf475730ec6",
          },
        ],
      },
    ];

    const fetchEndpoint = async (method, params) => {
      try {
        return await sendNocturneWsRequest(method, params, { timeoutMs: 8000 });
      } catch {
        return null;
      }
    };

    const fetchData = async () => {
      attempts++;

      try {
        const [recentRaw, playlistsRaw, artistsRaw, showsRaw] =
          await Promise.all([
            fetchEndpoint("spotify.me.recentlyPlayed", { limit: 10 }),
            fetchEndpoint("spotify.me.playlists", { limit: 50 }),
            fetchEndpoint("spotify.me.topArtists", { limit: 20 }),
            fetchEndpoint("spotify.me.shows", { limit: 20 }),
          ]);

        if (cancelled) return;

        let recentAlbums = parseRecentAlbums(recentRaw);
        let userPlaylists = playlistsRaw?.items || playlistsRaw || [];
        let topArtists = artistsRaw?.items || artistsRaw || [];
        let userShows = showsRaw?.items || showsRaw || [];

        const allLoaded =
          recentAlbums.length > 0 &&
          Array.isArray(userPlaylists) &&
          userPlaylists.length > 0 &&
          Array.isArray(topArtists) &&
          topArtists.length > 0;

        if (!allLoaded && attempts < MAX_ATTEMPTS) {
          if (!cancelled) {
            retryTimer = setTimeout(fetchData, 1500);
          }
          return;
        }

        if (recentAlbums.length === 0) {
          recentAlbums = FALLBACK_RECENTS;
        }
        if (!Array.isArray(userPlaylists)) userPlaylists = [];
        if (!Array.isArray(topArtists)) topArtists = [];
        if (!Array.isArray(userShows)) userShows = [];

        if (recentAlbums.length < 3 && !cancelled) {
          try {
            const likedRaw = await fetchEndpoint("spotify.me.tracks", {
              limit: 20,
              mockingbird: true,
            });
            if (!cancelled && likedRaw) {
              const likedItems =
                likedRaw?.items || likedRaw?.tracks || likedRaw || [];
              const seenIds = new Set(recentAlbums.map((a) => a.id));
              for (const item of Array.isArray(likedItems) ? likedItems : []) {
                const track = item.track || item;
                const album = track?.album;
                if (album && album.id && !seenIds.has(album.id)) {
                  seenIds.add(album.id);
                  if (!album.artists && track.artists)
                    album.artists = track.artists;
                  recentAlbums.push(album);
                  if (recentAlbums.length >= 8) break;
                }
              }
            }
          } catch (e) {}
        }

        if (cancelled) return;

        const rootStore = window.carThingRootStore;
        if (rootStore?.shelfStore) {
          runInAction(() =>
            rootStore.shelfStore.seedRecentAlbums(recentAlbums),
          );
        }

        setData({
          recentAlbums,
          userPlaylists,
          topArtists,
          likedSongs: [],
          radioMixes: [],
          userShows,
          initialDataLoaded: true,
        });
      } catch (e) {
        if (!cancelled) {
          retryTimer = setTimeout(fetchData, 1500);
        }
      }
    };

    fetchData();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [loaded]);

  return data || { initialDataLoaded: false };
}

function DataLoadingScreen() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
    >
      <div style={{ display: "flex", gap: "16px" }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              background: "#fff",
              animation: `mockingbird-dot-pulse 1.4s ease-in-out infinite`,
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
      </div>
      <style>{`
        @keyframes mockingbird-dot-pulse {
          0%, 80%, 100% { opacity: 0.15; }
          40% { opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}

function SplashOverlay() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#2d2d2d",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
    >
      <img
        src="/images/appstart.png"
        alt="Nocturne"
        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
      />
    </div>
  );
}

export default function MockingbirdShell({
  currentPlayback: parentPlayback,
  playerControls,
  spotifyData: parentSpotifyData,
  playbackProgress,
  systemScreen,
  onTutorialComplete,
}) {
  const currentPlayback = usePlaybackPolling(parentPlayback);
  const localSpotifyData = useSpotifyData();
  const spotifyData = parentSpotifyData?.initialDataLoaded
    ? parentSpotifyData
    : localSpotifyData;
  const dataReady = spotifyData.initialDataLoaded;

  if (systemScreen && systemScreen !== "tutorial") {
    return (
      <div className="mockingbird-root">
        <style>{mockingbirdFontStyles}</style>
        <CarThingStoreProvider
          currentPlayback={currentPlayback}
          playerControls={playerControls}
          spotifyData={spotifyData}
          playbackProgress={playbackProgress}
          onSeek={playerControls?.seekToPosition}
        >
          <React.Suspense fallback={<SplashOverlay />}>
            <LazySetup systemScreen={systemScreen} />
          </React.Suspense>
          <Settings />
        </CarThingStoreProvider>
      </div>
    );
  }

  if (systemScreen === "tutorial") {
    return (
      <div className="mockingbird-root">
        <style>{mockingbirdFontStyles}</style>
        {!dataReady ? (
          <DataLoadingScreen />
        ) : (
          <CarThingStoreProvider
            currentPlayback={currentPlayback}
            playerControls={playerControls}
            spotifyData={spotifyData}
            playbackProgress={playbackProgress}
            onSeek={playerControls?.seekToPosition}
          >
            <React.Suspense fallback={<SplashOverlay />}>
              <LazyOnboarding
                onComplete={onTutorialComplete}
                dataReady={dataReady}
              />
            </React.Suspense>
          </CarThingStoreProvider>
        )}
      </div>
    );
  }

  return (
    <div className="mockingbird-root">
      <style>{mockingbirdFontStyles}</style>
      {!dataReady ? (
        <SplashOverlay />
      ) : (
        <CarThingStoreProvider
          currentPlayback={currentPlayback}
          playerControls={playerControls}
          spotifyData={spotifyData}
          playbackProgress={playbackProgress}
          onSeek={playerControls?.seekToPosition}
        >
          <Main />
        </CarThingStoreProvider>
      )}
    </div>
  );
}
