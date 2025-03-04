import { useRouter } from "next/router";
import { useEffect, useState, useRef, useCallback } from "react";
import Redirect from "../../components/common/navigation/Redirect";
import TrackListNavigation from "../../components/common/navigation/TrackListNavigation";
import Image from "next/image";
import SuccessAlert from "../../components/common/alerts/SuccessAlert";
import { getCurrentDevice } from "@/services/deviceService";
import { setPlaybackShuffleState } from "@/services/playerService";
export const runtime = "experimental-edge";

const LikedSongsPage = ({
  initialTracks,
  currentlyPlayingTrackUri,
  handleError,
  error,
  updateGradientColors,
  setActiveSection,
}) => {
  const router = useRouter();
  const accessToken = router.query.accessToken;
  const [isShuffleEnabled, setIsShuffleEnabled] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("shuffleEnabled") === "true";
    }
    return false;
  });
  const [tracks, setTracks] = useState(initialTracks?.items || []);
  const [totalTracks, setTotalTracks] = useState(initialTracks?.total || 0);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(
    initialTracks?.total > initialTracks?.items?.length
  );
  const observer = useRef();
  const [showSuccess, setShowSuccess] = useState(false);
  const [pressedButton, setPressedButton] = useState(null);
  const tracksContainerRef = useRef(null);

  useEffect(() => {
    updateGradientColors(null, "library");
  }, [updateGradientColors]);

  useEffect(() => {
    const validKeys = ["1", "2", "3", "4"];
    const holdDuration = 2000;
    const holdTimeouts = {};
    const pressStartTimes = {};

    const handleKeyDown = (event) => {
      if (!validKeys.includes(event.key) || event.repeat) return;

      pressStartTimes[event.key] = Date.now();

      holdTimeouts[event.key] = setTimeout(() => {
        localStorage.setItem(`button${event.key}Map`, "liked-songs");
        localStorage.setItem(
          `button${event.key}Image`,
          "https://misc.scdn.co/liked-songs/liked-songs-640.png"
        );

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

  useEffect(() => {
    if (error) {
      handleError(error.type, error.message);
    }
  }, [error, handleError]);

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
    void setPlaybackShuffleState(accessToken, handleError, setIsShuffleEnabled);
  }, [accessToken]);

  useEffect(() => {
    const handleKeyPress = (event) => {
      if (event.key === "Enter") {
        playLikedSongs();
      }
    };
    window.addEventListener("keydown", handleKeyPress);
    return () => {
      window.removeEventListener("keydown", handleKeyPress);
    };
  }, [tracks, isShuffleEnabled]);

  const loadMoreTracks = async () => {
    if (isLoading || !hasMore) return;
    setIsLoading(true);
    const offset = tracks.length;
    const limit = 25;

    try {
      const response = await fetch(
        `https://api.spotify.com/v1/me/tracks?offset=${offset}&limit=${limit}`,
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
        setHasMore(tracks.length + data.items.length < totalTracks);
      }
    } catch (error) {
      console.error("Error fetching more tracks:", error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const playLikedSongs = async () => {
    try {
      const device = await getCurrentDevice(accessToken, handleError);
      const activeDeviceId = device == null ? null : device.id;

      if (device && !device.is_active) {
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

      localStorage.setItem("playingLikedSongs", "true");

      const savedShuffleState =
        localStorage.getItem("shuffleEnabled") === "true";

      await fetch(
        `https://api.spotify.com/v1/me/player/shuffle?state=${savedShuffleState}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      let startPosition = 0;
      if (savedShuffleState) {
        startPosition = Math.floor(Math.random() * tracks.length);
      }

      await fetch("https://api.spotify.com/v1/me/player/play", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          uris: tracks.map((item) => item.track.uri),
          offset: { position: startPosition },
          device_id: activeDeviceId,
        }),
      });

      const savedRepeatState = localStorage.getItem("repeatMode") || "off";
      await fetch(
        `https://api.spotify.com/v1/me/player/repeat?state=${savedRepeatState}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      setActiveSection("nowPlaying");
    } catch (error) {
      handleError("PLAY_LIKED_SONGS_ERROR", error.message);
    }
  };

  const playTrack = async (trackUri, trackIndex) => {
    try {
      const device = await getCurrentDevice(accessToken, handleError);
      const activeDeviceId = device == null ? null : device.id;
      localStorage.setItem("playingLikedSongs", "true");

      if (device && !device.is_active) {
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

      const savedShuffleState =
        localStorage.getItem("shuffleEnabled") === "true";
      await fetch(
        `https://api.spotify.com/v1/me/player/shuffle?state=${savedShuffleState}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      await fetch("https://api.spotify.com/v1/me/player/play", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          uris: tracks.map((item) => item.track.uri),
          offset: { position: trackIndex },
          device_id: activeDeviceId,
        }),
      });

      const savedRepeatState = localStorage.getItem("repeatMode") || "off";
      await fetch(
        `https://api.spotify.com/v1/me/player/repeat?state=${savedRepeatState}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      setActiveSection("nowPlaying");
    } catch (error) {
      console.error("Error playing track:", error.message);
    }
  };

  return (
    <div className="flex flex-col md:flex-row gap-8 pt-10 px-12 fadeIn-animation">
      <div className="md:w-1/3 sticky top-10">
        <div className="min-w-[280px] mr-10">
          <div onClick={playLikedSongs}>
            <Image
              src="https://misc.scdn.co/liked-songs/liked-songs-640.png"
              alt="Liked Songs"
              width={280}
              height={280}
              className="aspect-square rounded-[12px] drop-shadow-xl"
            />
          </div>
          <h4 className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]">
            Liked Songs
          </h4>
          <h4 className="text-[28px] font-[560] text-white/60 truncate tracking-tight max-w-[280px]">
            {totalTracks.toLocaleString()} Songs
          </h4>
        </div>
      </div>

      <div
        className="md:w-2/3 pl-20 h-[calc(100vh-5rem)] overflow-y-auto scroll-container scroll-smooth pb-12"
        ref={tracksContainerRef}
      >
        <TrackListNavigation
          tracks={tracks}
          containerRef={tracksContainerRef}
          accessToken={accessToken}
          currentlyPlayingTrackUri={currentlyPlayingTrackUri}
          playTrack={playTrack}
        />
        {tracks.map((item, index) => (
          <div
            key={item.track.id}
            className="flex gap-12 items-start mb-4 transition-transform duration-200 ease-out"
            style={{ transition: "transform 0.2s ease-out" }}
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
              <div onClick={() => playTrack(item.track.uri, index)}>
                <p className="text-[32px] font-[580] text-white truncate tracking-tight max-w-[280px]">
                  {item.track.name}
                </p>
              </div>
              <div className="flex flex-wrap">
                {item.track.artists.map((artist, artistIndex) => (
                  <Redirect
                    key={artist.id}
                    href={`/artist/${artist.id}`}
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
                  </Redirect>
                ))}
              </div>
            </div>
          </div>
        ))}
        {isLoading && <div className="flex justify-center mt-4" />}
      </div>
      <SuccessAlert
        show={showSuccess}
        onClose={() => {
          setShowSuccess(false);
          setPressedButton(null);
        }}
        message={`Liked Songs mapped to Button ${pressedButton}`}
      />
    </div>
  );
};

export async function getServerSideProps(context) {
  const accessToken = context.query.accessToken;

  try {
    const res = await fetch(`https://api.spotify.com/v1/me/tracks?limit=25`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      throw new Error("Failed to fetch liked songs");
    }

    const tracksData = await res.json();

    return {
      props: {
        initialTracks: tracksData,
        accessToken,
        error: null,
      },
    };
  } catch (error) {
    return {
      props: {
        error: {
          type: "FETCH_LIKED_SONGS_ERROR",
          message: error.message,
        },
        initialTracks: null,
        accessToken,
      },
    };
  }
}

export default LikedSongsPage;
