import { useRouter } from "next/router";
import { useEffect, useState, useRef, useCallback } from "react";
import LongPressLink from "../../components/LongPressLink";

const AlbumPage = ({ initialAlbum, currentlyPlayingTrackUri, handleError }) => {
  const router = useRouter();
  const accessToken = router.query.accessToken;
  const [isShuffleEnabled, setIsShuffleEnabled] = useState(false);
  const [album, setAlbum] = useState(initialAlbum);
  const [tracks, setTracks] = useState(initialAlbum.tracks.items);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(
    initialAlbum.tracks.total > initialAlbum.tracks.items.length
  );
  const observer = useRef();

  const lastTrackElementRef = useCallback(
    (node) => {
      if (isLoading) return;
      if (observer.current) observer.current.disconnect();
      observer.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasMore) {
          loadMoreTracks();
        }
      });
      if (node) observer.current.observe(node);
    },
    [isLoading, hasMore]
  );

  useEffect(() => {
    const albumImage =
      album.images && album.images.length > 0 && album.images[0].url;
    localStorage.setItem("albumPageImage", albumImage);
  }, [album]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Enter") {
        playAlbum();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isShuffleEnabled]);

  useEffect(() => {
    const fetchPlaybackState = async () => {
      try {
        const response = await fetch("https://api.spotify.com/v1/me/player", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        if (response.ok) {
          const data = await response.json();
          setIsShuffleEnabled(data.shuffle_state);
        }
      } catch (error) {
        handleError("FETCH_PLAYBACK_STATE_ERROR", error.message);
      }
    };

    fetchPlaybackState();
  }, [accessToken]);

  const loadMoreTracks = async () => {
    if (isLoading || !hasMore) return;
    setIsLoading(true);
    const offset = tracks.length;
    const limit = 25;

    try {
      const response = await fetch(
        `https://api.spotify.com/v1/albums/${album.id}/tracks?offset=${offset}&limit=${limit}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch more tracks");
      }

      const data = await response.json();
      if (data.items.length === 0) {
        setHasMore(false);
      } else {
        setTracks((prevTracks) => [...prevTracks, ...data.items]);
        setHasMore(tracks.length + data.items.length < album.tracks.total);
      }
    } catch (error) {
      handleError("LOAD_MORE_TRACKS_ERROR", error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const playAlbum = async () => {
    try {
      const devicesResponse = await fetch(
        "https://api.spotify.com/v1/me/player/devices",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      const devicesData = await devicesResponse.json();

      if (devicesData.devices.length === 0) {
        handleError(
          "NO_DEVICES_AVAILABLE",
          "No devices available for playback"
        );
        return;
      }

      const device = devicesData.devices[0];
      const activeDeviceId = device.id;

      if (!device.is_active) {
        await fetch("https://api.spotify.com/v1/me/player", {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            device_ids: [activeDeviceId],
            play: false,
          }),
        });
      }

      await fetch(
        `https://api.spotify.com/v1/me/player/shuffle?state=${isShuffleEnabled}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      let offset;
      if (isShuffleEnabled) {
        const randomPosition = Math.floor(Math.random() * album.tracks.total);
        offset = { position: randomPosition };
      } else {
        offset = { position: 0 };
      }

      await fetch("https://api.spotify.com/v1/me/player/play", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          context_uri: album.uri,
          offset: offset,
        }),
      });
      router.push("/now-playing");
    } catch (error) {
      handleError("PLAY_ALBUM_ERROR", error.message);
    }
  };

  const playTrack = async (trackUri, trackIndex) => {
    try {
      const devicesResponse = await fetch(
        "https://api.spotify.com/v1/me/player/devices",
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      const devicesData = await devicesResponse.json();

      if (devicesData.devices.length === 0) {
        handleError(
          "NO_DEVICES_AVAILABLE",
          "No devices available for playback"
        );
        return;
      }

      const device = devicesData.devices[0];
      const activeDeviceId = device.id;

      if (!device.is_active) {
        const transferResponse = await fetch(
          "https://api.spotify.com/v1/me/player",
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              device_ids: [activeDeviceId],
              play: false,
            }),
          }
        );

        if (!transferResponse.ok) {
          const errorData = await transferResponse.json();
          handleError("TRANSFER_PLAYBACK_ERROR", errorData.error.message);
          return;
        }
      }

      const playResponse = await fetch(
        "https://api.spotify.com/v1/me/player/play",
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            context_uri: album.uri,
            offset: { position: trackIndex },
            device_id: activeDeviceId,
          }),
        }
      );

      if (!playResponse.ok) {
        const errorData = await playResponse.json();
        handleError("PLAY_TRACK_ERROR", errorData.error.message);
      }
      router.push("/now-playing");
    } catch (error) {
      handleError("PLAY_TRACK_REQUEST_ERROR", error.message);
    }
  };

  return (
    <div className="flex flex-col md:flex-row gap-8 pt-10 px-12 max-h-screen">
      <div className="md:w-1/3 h-screen sticky top-0">
        {album.images && album.images.length > 0 ? (
          <div className="min-w-[280px] mr-10">
            <LongPressLink
              href={`/`}
              spotifyUrl={album.external_urls.spotify}
              accessToken={accessToken}
            >
              <img
                src={album.images[0].url}
                alt="Album Cover"
                className="w-[280px] h-[280px] aspect-square rounded-[12px] drop-shadow-xl"
              />
            </LongPressLink>
            <LongPressLink
              href={`/`}
              spotifyUrl={album.external_urls.spotify}
              accessToken={accessToken}
            >
              <h4 className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]">
                {album.name}
              </h4>
            </LongPressLink>
            <LongPressLink
              href={`/artist/${album.artists[0].id}`}
              spotifyUrl={album.artists[0].external_urls.spotify}
              accessToken={accessToken}
            >
              <h4 className="text-[28px] font-[560] text-white/60 truncate tracking-tight max-w-[280px]">
                {album.artists.map((artist) => artist.name).join(", ")}
              </h4>
            </LongPressLink>
          </div>
        ) : (
          <p>No image available</p>
        )}
      </div>

      <div className="md:w-2/3 ml-20 h-screen overflow-y-scroll scroll-container pb-12">
        {tracks.map((track, index) => (
          <div
            key={track.id}
            className="flex gap-12 items-start mb-4"
            ref={index === tracks.length - 1 ? lastTrackElementRef : null}
          >
            <div className="text-[32px] font-[580] text-center text-white/60 w-6 mt-3">
              {track.uri === currentlyPlayingTrackUri ? (
                <div className="w-5">
                  <section>
                    <div className="wave0"></div>
                    <div className="wave1"></div>
                    <div className="wave2"></div>
                    <div className="wave3"></div>
                  </section>
                </div>
              ) : (
                <p>{index + 1}</p>
              )}
            </div>

            <div className="flex-grow">
              <LongPressLink
                href="/now-playing"
                spotifyUrl={track.external_urls.spotify}
                accessToken={accessToken}
              >
                <div onClick={() => playTrack(track.uri, index)}>
                  <p className="text-[32px] font-[580] text-white truncate tracking-tight max-w-[280px]">
                    {track.name}
                  </p>
                </div>
              </LongPressLink>
              <LongPressLink
                href={`/artist/${track.artists[0].id}`}
                spotifyUrl={track.artists[0].external_urls.spotify}
                accessToken={accessToken}
              >
                <p className="text-[28px] font-[560] text-white/60 truncate tracking-tight max-w-[280px]">
                  {track.artists.map((artist) => artist.name).join(", ")}
                </p>
              </LongPressLink>
            </div>
          </div>
        ))}
        {isLoading && (
          <p className="text-white text-center">Loading more tracks...</p>
        )}
      </div>
    </div>
  );
};

export async function getServerSideProps(context) {
  const { albumId } = context.params;
  const accessToken = context.query.accessToken;

  const res = await fetch(`https://api.spotify.com/v1/albums/${albumId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const errorData = await res.json();
    handleError("FETCH_ALBUM_ERROR", errorData.error.message);
    return { notFound: true };
  }

  const albumData = await res.json();

  const tracksRes = await fetch(
    `https://api.spotify.com/v1/albums/${albumId}/tracks?limit=25`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  const tracksData = await tracksRes.json();

  const initialAlbum = {
    ...albumData,
    tracks: {
      ...albumData.tracks,
      items: tracksData.items,
    },
  };

  return {
    props: { initialAlbum, accessToken },
  };
}

export default AlbumPage;
