import { useRouter } from "next/router";
import { useEffect, useState, useRef, useCallback } from "react";
import TrackListNavigation from "../../components/common/navigation/TrackListNavigation";
import Image from "next/image";
import { getCurrentDevice } from "@/services/deviceService";

export const runtime = "experimental-edge";

const ShowPage = ({
  initialShow,
  updateGradientColors,
  currentlyPlayingTrackUri,
  handleError,
  error,
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
  const [show, setShow] = useState(initialShow);
  const [episodes, setEpisodes] = useState(initialShow.episodes.items);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(
    initialShow.episodes.total > initialShow.episodes.items.length
  );
  const observer = useRef();
  const tracksContainerRef = useRef(null);

  useEffect(() => {
    if (error) {
      handleError(error.type, error.message);
    }
  }, [error, handleError]);

  const lastEpisodeElementRef = useCallback(
    (node) => {
      if (isLoading) return;
      if (observer.current) observer.current.disconnect();
      observer.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasMore) {
          loadMoreEpisodes();
        }
      });
      if (node) observer.current.observe(node);
    },
    [isLoading, hasMore]
  );

  useEffect(() => {
    if (show?.images && show.images.length > 0) {
      const showImage = show.images[0].url;
      localStorage.setItem("showPageImage", showImage);
      updateGradientColors(showImage);
    }

    return () => {
      updateGradientColors(null);
    };
  }, [show, updateGradientColors]);

  const loadMoreEpisodes = async () => {
    if (isLoading || !hasMore) return;
    setIsLoading(true);
    const offset = episodes.length;
    const limit = 25;

    try {
      const response = await fetch(
        `https://api.spotify.com/v1/shows/${show.id}/episodes?offset=${offset}&limit=${limit}&market=US`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch more episodes");
      }

      const data = await response.json();
      if (data.items.length === 0) {
        setHasMore(false);
      } else {
        setEpisodes((prevEpisodes) => [...prevEpisodes, ...data.items]);
        setHasMore(episodes.length + data.items.length < show.episodes.total);
      }
    } catch (error) {
      console.error("Error fetching more episodes:", error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const playEpisode = async (episodeUri, episodeIndex) => {
    try {
      const device = await getCurrentDevice(accessToken, handleError);
      const activeDeviceId = device == null ? null : device.id;

      if (device && !device.is_active) {
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

      const playResponse = await fetch(
        "https://api.spotify.com/v1/me/player/play",
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            uris: [episodeUri],
            device_id: activeDeviceId,
          }),
        }
      );

      if (!playResponse.ok) {
        const errorData = await playResponse.json();
        console.error("Error playing episode:", errorData.error.message);
      }

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
      router.push("/");
    } catch (error) {
      console.error("Error playing episode:", error.message);
    }
  };

  const formatDuration = (ms) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes} min ${seconds} sec`;
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return (
    <div className="flex flex-col md:flex-row gap-8 pt-10 px-12 fadeIn-animation">
      <div className="md:w-1/3 sticky top-10">
        {show.images && show.images.length > 0 ? (
          <div className="min-w-[280px] mr-10">
            <Image
              src={show.images[0].url || "/images/not-playing.webp"}
              alt="Show Cover"
              width={280}
              height={280}
              priority
              className="aspect-square rounded-[12px] drop-shadow-xl"
            />
            <h4 className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]">
              {show.name}
            </h4>
            <h4 className="text-[28px] font-[560] text-white/60 truncate tracking-tight max-w-[280px]">
              {show.publisher}
            </h4>
          </div>
        ) : (
          <p>No image available</p>
        )}
      </div>

      <div
        className="md:w-2/3 pl-20 h-[calc(100vh-5rem)] overflow-y-auto scroll-container scroll-smooth pb-12"
        ref={tracksContainerRef}
      >
        <TrackListNavigation
          tracks={episodes.map((episode) => ({
            ...episode,
            uri: episode.uri,
            id: episode.id,
            name: episode.name,
          }))}
          containerRef={tracksContainerRef}
          accessToken={accessToken}
          currentlyPlayingTrackUri={currentlyPlayingTrackUri}
          playTrack={playEpisode}
        />
        {episodes.map((episode, index) => (
          <div
            key={episode.id}
            className="flex gap-12 items-start mb-8 transition-transform duration-200 ease-out"
            style={{ transition: "transform 0.2s ease-out" }}
            ref={index === episodes.length - 1 ? lastEpisodeElementRef : null}
          >
            <div className="text-[32px] font-[580] text-center text-white/60 w-6 mt-3">
              {episode.uri === currentlyPlayingTrackUri ? (
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
              <div onClick={() => playEpisode(episode.uri, index)}>
                <p className="text-[32px] font-[580] text-white truncate tracking-tight max-w-[280px]">
                  {episode.name}
                </p>
              </div>
              <p className="text-[24px] font-[560] text-white/60 tracking-tight max-w-[560px] line-clamp-2 mb-2">
                {episode.description}
              </p>
              <div className="flex space-x-4 text-[20px] font-[560] text-white/40">
                <span>{formatDate(episode.release_date)}</span>
              </div>
              <div className="flex space-x-4 text-[20px] font-[560] text-white/40">
                <span>{formatDuration(episode.duration_ms)}</span>
              </div>
            </div>
          </div>
        ))}
        {isLoading && <div className="flex justify-center mt-4" />}
      </div>
    </div>
  );
};

export async function getServerSideProps(context) {
  const { showId } = context.params;
  const accessToken = context.query.accessToken;

  try {
    const [showRes, episodesRes] = await Promise.all([
      fetch(`https://api.spotify.com/v1/shows/${showId}?market=US`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }),
      fetch(
        `https://api.spotify.com/v1/shows/${showId}/episodes?market=US&limit=25`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      ),
    ]);

    if (!showRes.ok || !episodesRes.ok) {
      const errorData = await showRes.json();
      return {
        props: {
          error: {
            type: "FETCH_SHOW_ERROR",
            message: errorData.error.message,
          },
          initialShow: null,
          accessToken,
        },
      };
    }

    const [showData, episodesData] = await Promise.all([
      showRes.json(),
      episodesRes.json(),
    ]);

    const initialShow = {
      ...showData,
      episodes: {
        ...episodesData,
        items: episodesData.items,
      },
    };

    return {
      props: { initialShow, accessToken, error: null },
    };
  } catch (error) {
    return {
      props: {
        error: {
          type: "FETCH_SHOW_ERROR",
          message: error.message,
        },
        initialShow: null,
        accessToken,
      },
    };
  }
}

export default ShowPage;
