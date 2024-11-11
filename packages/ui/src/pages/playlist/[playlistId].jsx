import { useRouter } from "next/router";
import { useEffect, useState, useRef, useCallback } from "react";
import LongPressLink from "../../components/LongPressLink";
import Image from "next/image";
import SuccessAlert from "../../components/SuccessAlert";
export const runtime = "experimental-edge";

const PlaylistPage = ({
  initialPlaylist,
  currentlyPlayingTrackUri,
  handleError,
  error,
}) => {
  const router = useRouter();
  const accessToken = router.query.accessToken;
  const [isShuffleEnabled, setIsShuffleEnabled] = useState(false);
  const [playlist, setPlaylist] = useState(initialPlaylist);
  const [tracks, setTracks] = useState(initialPlaylist.tracks.items);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(
    initialPlaylist.tracks.total > initialPlaylist.tracks.items.length
  );
  const observer = useRef();
  const [showSuccess, setShowSuccess] = useState(false);
  const [pressedButton, setPressedButton] = useState(null);

  useEffect(() => {
    const validKeys = ["1", "2", "3", "4"];
    const holdDuration = 2000;
    const holdTimeouts = {};
    const pressStartTimes = {};

    const handleKeyDown = (event) => {
      if (!validKeys.includes(event.key) || event.repeat) return;

      pressStartTimes[event.key] = Date.now();

      holdTimeouts[event.key] = setTimeout(() => {
        const currentUrl = window.location.pathname;
        const currentImage = localStorage.getItem("playlistPageImage");

        localStorage.setItem(`button${event.key}Map`, currentUrl);
        if (currentImage) {
          localStorage.setItem(`button${event.key}Image`, currentImage);
        }

        setPressedButton(event.key);
        setShowSuccess(true);
      }, holdDuration);
    };

    const handleKeyUp = (event) => {
      if (!validKeys.includes(event.key)) return;

      if (holdTimeouts[event.key]) {
        clearTimeout(holdTimeouts[event.key]);
        delete holdTimeouts[event.key];
      }

      delete pressStartTimes[event.key];
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      Object.values(holdTimeouts).forEach(
        (timeout) => timeout && clearTimeout(timeout)
      );
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const handleSuccessClose = useCallback(() => {
    setShowSuccess(false);
    setPressedButton(null);
  }, []);

  useEffect(() => {
    if (error) {
      handleError(error.type, error.message);
    }
  }, [error, handleError]);

  useEffect(() => {
    const fetchPlaylist = async () => {
      try {
        const res = await fetch(
          `https://api.spotify.com/v1/playlists/${router.query.playlistId}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        if (!res.ok) {
          throw new Error("Failed to fetch playlist");
        }

        const playlistData = await res.json();

        const tracksRes = await fetch(
          `https://api.spotify.com/v1/playlists/${router.query.playlistId}/tracks?limit=25`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        const tracksData = await tracksRes.json();

        setPlaylist({
          ...playlistData,
          tracks: {
            ...playlistData.tracks,
            items: tracksData.items,
          },
        });
        setTracks(tracksData.items);
        setHasMore(playlistData.tracks.total > tracksData.items.length);
      } catch (error) {
        handleError("FETCH_PLAYLIST_ERROR", error.message);
      }
    };

    if (router.query.playlistId && accessToken) {
      fetchPlaylist();
    }
  }, [router.query.playlistId, accessToken]);

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
    const playlistImage =
      playlist.images && playlist.images.length > 0
        ? playlist.images[0].url
        : "";
    localStorage.setItem("playlistPageImage", playlistImage);
  }, [playlist]);

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
        `https://api.spotify.com/v1/playlists/${playlist.id}/tracks?offset=${offset}&limit=${limit}`,
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
        setHasMore(tracks.length + data.items.length < playlist.tracks.total);
      }
    } catch (error) {
      handleError("LOAD_MORE_TRACKS_ERROR", error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const playPlaylist = async () => {
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
        const randomPosition = Math.floor(
          Math.random() * playlist.tracks.total
        );
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
          context_uri: `spotify:playlist:${playlist.id}`,
          offset: offset,
        }),
      });
      router.push("/now-playing");
    } catch (error) {
      handleError("PLAY_PLAYLIST_ERROR", error.message);
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
            context_uri: `spotify:playlist:${playlist.id}`,
            offset: {
              position: trackIndex,
            },
            device_id: activeDeviceId,
          }),
        }
      );

      if (!playResponse.ok) {
        const errorData = await playResponse.json();
        handleError("PLAY_TRACK_ERROR", errorData.error.message);
      }
    } catch (error) {
      handleError("PLAY_TRACK_REQUEST_ERROR", error.message);
    }
  };

  const onCloseAlert = useCallback(() => {
    setShowSuccess(false);
    setPressedButton(null);
  }, []);

  return (
    <div className="flex flex-col md:flex-row gap-8 pt-10 px-12 max-h-screen fadeIn-animation">
      <div className="md:w-1/3 h-screen sticky top-0">
        {playlist.images && playlist.images.length > 0 ? (
          <div className="min-w-[280px] mr-10">
            <LongPressLink
              spotifyUrl={playlist.external_urls.spotify}
              accessToken={accessToken}
            >
              <Image
                src={playlist.images[0].url || "/images/not-playing.webp"}
                alt="Playlist Cover"
                data-main-image
                width={280}
                height={280}
                className="aspect-square rounded-[12px] drop-shadow-xl"
              />
            </LongPressLink>
            <LongPressLink
              spotifyUrl={playlist.external_urls.spotify}
              accessToken={accessToken}
            >
              <h4 className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]">
                {playlist.name}
              </h4>
            </LongPressLink>
            <h4 className="text-[28px] font-[560] text-white/60 truncate tracking-tight max-w-[280px]">
              {playlist.tracks.total.toLocaleString()} Songs
            </h4>
          </div>
        ) : (
          <p>No image available</p>
        )}
      </div>

      <div className="md:w-2/3 ml-20 h-screen overflow-y-scroll scroll-container scroll-smooth pb-12">
        {tracks.map((item, index) => (
          <div
            key={item.track.id}
            className="flex gap-12 items-start mb-4"
            ref={index === tracks.length - 1 ? lastTrackElementRef : null}
          >
            <div className="text-[32px] font-[580] text-center text-white/60 w-6 mt-3">
              {item.track.uri === currentlyPlayingTrackUri ? (
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
                spotifyUrl={item.track.external_urls.spotify}
                accessToken={accessToken}
              >
                <div onClick={() => playTrack(item.track.uri, index)}>
                  <p className="text-[32px] font-[580] text-white truncate tracking-tight max-w-[280px]">
                    {item.track.name}
                  </p>
                </div>
              </LongPressLink>
              <div className="flex flex-wrap">
                {item.track.artists.map((artist, artistIndex) => (
                  <LongPressLink
                    key={artist.id}
                    spotifyUrl={artist.external_urls.spotify}
                    accessToken={accessToken}
                  >
                    <p
                      className={`text-[28px] font-[560] text-white/60 truncate tracking-tight ${
                        artistIndex < item.track.artists.length - 1
                          ? 'mr-2 after:content-[","]'
                          : ""
                      }`}
                    >
                      {artist.name}
                    </p>
                  </LongPressLink>
                ))}
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
          <p className="text-white text-center">Loading more tracks...</p>
        )}
      </div>
      <SuccessAlert
        show={showSuccess}
        onClose={onCloseAlert}
        message={`Playlist mapped to Button ${pressedButton}`}
      />
    </div>
  );
};

export async function getServerSideProps(context) {
  const { playlistId } = context.params;
  const accessToken = context.query.accessToken;

  try {
    const res = await fetch(
      `https://api.spotify.com/v1/playlists/${playlistId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!res.ok) {
      const errorData = await res.json();
      return {
        props: {
          error: {
            type: "FETCH_PLAYLIST_ERROR",
            message: errorData.error.message,
          },
          initialPlaylist: null,
          accessToken,
        },
      };
    }

    const playlistData = await res.json();

    const tracksRes = await fetch(
      `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=25`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const tracksData = await tracksRes.json();

    const initialPlaylist = {
      ...playlistData,
      tracks: {
        ...playlistData.tracks,
        items: tracksData.items,
      },
    };

    return {
      props: {
        initialPlaylist,
        accessToken,
        error: null,
      },
    };
  } catch (error) {
    return {
      props: {
        error: {
          type: "FETCH_PLAYLIST_ERROR",
          message: error.message,
        },
        initialPlaylist: null,
        accessToken,
      },
    };
  }
}

export default PlaylistPage;
