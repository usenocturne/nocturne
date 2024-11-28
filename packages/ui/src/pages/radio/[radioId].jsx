import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import LongPressLink from "../../components/LongPressLink";
import Image from "next/image";
export const runtime = "experimental-edge";

const RadioMix = ({
  initialMix,
  initialTracks,
  recentlyPlayedData,
  savedTracksData,
  topTracksData,
  currentlyPlayingTrackUri,
  handleError,
  error,
}) => {
  const router = useRouter();
  const { radioId } = router.query;
  const accessToken = router.query.accessToken;
  const [isShuffleEnabled, setIsShuffleEnabled] = useState(false);
  const [mix, setMix] = useState(initialMix);
  const [tracks, setTracks] = useState(initialTracks);
  const [isLoadingAdditionalTracks, setIsLoadingAdditionalTracks] =
    useState(false);

  useEffect(() => {
    if (error) {
      handleError(error.type, error.message);
    }
  }, [error, handleError]);

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
        console.warn("Failed to fetch playback state:", error);
      }
    };

    fetchPlaybackState();
  }, [accessToken]);

  useEffect(() => {
    const fetchAdditionalTracks = async () => {
      if (
        !accessToken ||
        !radioId ||
        isLoadingAdditionalTracks ||
        tracks.length >= 50
      )
        return;

      const simpleRadioTypes = [
        "recently-played-mix",
        "top-mix",
        "morning-mix",
        "afternoon-mix",
        "evening-mix",
      ];

      if (simpleRadioTypes.includes(radioId)) return;

      setIsLoadingAdditionalTracks(true);

      try {
        let additionalTracks = [];

        switch (radioId) {
          case "upbeat-mix":
          case "chill-mix": {
            const allTracks = [
              ...(savedTracksData?.items || []),
              ...(recentlyPlayedData?.items || []),
              ...(topTracksData?.items || []),
            ]
              .map((item) => item?.track)
              .filter(Boolean);

            const keywords =
              radioId === "upbeat-mix"
                ? [
                    "dance",
                    "party",
                    "remix",
                    "club",
                    "beat",
                    "energy",
                    "fast",
                    "power",
                  ]
                : [
                    "chill",
                    "relax",
                    "sleep",
                    "calm",
                    "acoustic",
                    "ambient",
                    "lo-fi",
                    "slow",
                  ];

            additionalTracks = allTracks.filter((track) => {
              const name = track.name.toLowerCase();
              const artistName = track.artists?.[0]?.name.toLowerCase() || "";
              return keywords.some(
                (keyword) =>
                  name.includes(keyword) || artistName.includes(keyword)
              );
            });
            break;
          }

          case "recent-discoveries-mix": {
            if (!recentlyPlayedData?.items) break;

            const playCountMap = new Map();
            recentlyPlayedData.items.forEach((item) => {
              const trackId = item.track.id;
              playCountMap.set(trackId, (playCountMap.get(trackId) || 0) + 1);
            });
            additionalTracks = recentlyPlayedData.items
              .filter((item) => playCountMap.get(item.track.id) <= 2)
              .map((item) => item.track);
            break;
          }
        }

        if (additionalTracks.length > 0) {
          setTracks((prevTracks) => {
            const existingTracksMap = new Map(
              prevTracks.map((track) => [track.id, track])
            );

            additionalTracks.forEach((track) => {
              existingTracksMap.set(track.id, track);
            });

            const newTracks = Array.from(existingTracksMap.values()).slice(
              0,
              50
            );

            setMix((prev) => ({
              ...prev,
              tracks: { ...prev.tracks, total: newTracks.length },
            }));

            return newTracks;
          });
        }
      } catch (error) {
        console.error("Error processing additional tracks:", error);
        handleError("PROCESS_ADDITIONAL_TRACKS_ERROR", error.message);
      } finally {
        setIsLoadingAdditionalTracks(false);
      }
    };

    fetchAdditionalTracks();
  }, [accessToken, radioId, isLoadingAdditionalTracks, tracks.length]);

  const playMix = async () => {
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
        const randomPosition = Math.floor(Math.random() * tracks.length);
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
          uris: tracks.map((track) => track.uri),
          offset: offset,
        }),
      });

      router.push("/now-playing");
    } catch (error) {
      handleError("PLAY_MIX_ERROR", error.message);
    }
  };

  const playTrack = async (trackUri, trackIndex) => {
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

      const tracksToPlay = tracks.slice(trackIndex).map((track) => track.uri);

      const playResponse = await fetch(
        "https://api.spotify.com/v1/me/player/play",
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            uris: tracksToPlay,
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

  if (!mix || !tracks.length) {
    return null;
  }

  return (
    <div className="flex flex-col md:flex-row gap-8 pt-10 px-12 max-h-screen fadeIn-animation">
      <div className="md:w-1/3 h-screen sticky top-0">
        <div className="min-w-[280px] mr-10">
          <Image
            src={mix.images[0].url || "/images/not-playing.webp"}
            alt="Mix Cover"
            width={280}
            height={280}
            className="aspect-square rounded-[12px] drop-shadow-xl"
            onClick={playMix}
          />
          <h4 className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]">
            {mix.name}
          </h4>
          <h4 className="text-[28px] font-[560] text-white/60 truncate tracking-tight max-w-[280px]">
            {mix.tracks.total.toLocaleString()} Songs
          </h4>
        </div>
      </div>

      <div className="md:w-2/3 ml-20 h-screen overflow-y-scroll scroll-container scroll-smooth pb-12">
        {tracks.map((track, index) => (
          <div key={track.id} className="flex gap-12 items-start mb-4">
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
                spotifyUrl={track.external_urls?.spotify}
                accessToken={accessToken}
              >
                <div onClick={() => playTrack(track.uri, index)}>
                  <p className="text-[32px] font-[580] text-white truncate tracking-tight max-w-[280px]">
                    {track.name}
                  </p>
                </div>
              </LongPressLink>
              <div className="flex flex-wrap">
                {track.artists.map((artist, artistIndex) => (
                  <LongPressLink
                    key={artist.id}
                    spotifyUrl={artist.external_urls?.spotify}
                    accessToken={accessToken}
                  >
                    <p
                      className={`text-[28px] font-[560] text-white/60 truncate tracking-tight ${
                        artistIndex < track.artists.length - 1
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
        {isLoadingAdditionalTracks && (
          <div className="flex justify-center mt-4">
            <p className="text-white/60">Loading more tracks...</p>
          </div>
        )}
      </div>
    </div>
  );
};

export async function getServerSideProps(context) {
  const { radioId } = context.params;
  const accessToken = context.query.accessToken;

  try {
    const [recentlyPlayedRes, savedTracksRes, topTracksRes] = await Promise.all(
      [
        fetch("https://api.spotify.com/v1/me/player/recently-played?limit=50", {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
        fetch("https://api.spotify.com/v1/me/tracks?limit=50", {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
        fetch(
          "https://api.spotify.com/v1/me/top/tracks?time_range=long_term&limit=50",
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        ),
      ]
    );

    const [recentlyPlayedData, savedTracksData, topTracksData] =
      await Promise.all([
        recentlyPlayedRes.json(),
        savedTracksRes.json(),
        topTracksRes.json(),
      ]);

    let initialMix;
    let initialTracks;

    switch (radioId) {
      case "recently-played-mix": {
        initialTracks = recentlyPlayedData.items.map((item) => item.track);
        initialMix = {
          name: "Recent Mix",
          description: "Your recently played tracks",
          images: [{ url: "/images/radio-cover/recent.webp" }],
          tracks: { total: initialTracks.length },
        };
        break;
      }

      case "top-mix": {
        initialTracks = topTracksData.items;
        initialMix = {
          name: "Your Top Mix",
          description: "Your most played tracks this year",
          images: [{ url: "/images/radio-cover/top.webp" }],
          tracks: { total: initialTracks.length },
        };
        break;
      }

      case "morning-mix": {
        initialTracks = savedTracksData.items
          .slice(0, 20)
          .map((item) => item.track);
        initialMix = {
          name: "Morning Mix",
          description: "Perfect for your morning routine",
          images: [{ url: "/images/radio-cover/morning.webp" }],
          tracks: { total: initialTracks.length },
        };
        break;
      }

      case "afternoon-mix": {
        initialTracks = topTracksData.items.slice(0, 20);
        initialMix = {
          name: "Afternoon Mix",
          description: "Energetic tracks to keep you going",
          images: [{ url: "/images/radio-cover/afternoon.webp" }],
          tracks: { total: initialTracks.length },
        };
        break;
      }

      case "evening-mix": {
        initialTracks = recentlyPlayedData.items
          .slice(0, 20)
          .map((item) => item.track);
        initialMix = {
          name: "Evening Mix",
          description: "Wind down with these tracks",
          images: [{ url: "/images/radio-cover/evening.webp" }],
          tracks: { total: initialTracks.length },
        };
        break;
      }

      case "upbeat-mix":
      case "chill-mix":
      case "recent-discoveries-mix": {
        const mixConfigs = {
          "upbeat-mix": {
            name: "Upbeat Mix",
            description: "High energy tracks to get you moving",
            imagePath: "/images/radio-cover/upbeat.webp",
          },
          "chill-mix": {
            name: "Chill Mix",
            description: "Relaxed tracks for laid-back moments",
            imagePath: "/images/radio-cover/chill.webp",
          },
          "recent-discoveries-mix": {
            name: "Discoveries",
            description: "New tracks you've been exploring",
            imagePath: "/images/radio-cover/discoveries.webp",
          },
        };

        initialTracks = recentlyPlayedData.items
          .slice(0, 20)
          .map((item) => item.track);
        initialMix = {
          name: mixConfigs[radioId].name,
          description: mixConfigs[radioId].description,
          images: [{ url: mixConfigs[radioId].imagePath }],
          tracks: { total: initialTracks.length },
        };
        break;
      }

      default: {
        if (radioId.startsWith("era-mix-")) {
          const decade = radioId.split("-").pop();

          initialTracks = savedTracksData.items
            .map((item) => item.track)
            .filter((track) => {
              if (!track?.album?.release_date) return false;
              const year = new Date(track.album.release_date).getFullYear();
              const trackDecade = Math.floor(year / 10) * 10;
              return trackDecade === parseInt(decade);
            })
            .slice(0, 20);

          initialMix = {
            name: `${decade}s Mix`,
            description: `Your favorite tracks from the ${decade}s`,
            images: [{ url: `/images/radio-cover/${decade}s.webp` }],
            tracks: { total: initialTracks.length },
          };
        } else {
          throw new Error("Invalid mix type");
        }
        break;
      }
    }

    if (!initialMix || !initialTracks || initialTracks.length === 0) {
      return {
        props: {
          error: {
            type: "NO_TRACKS_AVAILABLE",
            message: "No tracks available for this mix",
          },
          initialMix: null,
          initialTracks: [],
          recentlyPlayedData: null,
          savedTracksData: null,
          topTracksData: null,
          accessToken,
        },
      };
    }

    return {
      props: {
        initialMix,
        initialTracks,
        recentlyPlayedData,
        savedTracksData,
        topTracksData,
        accessToken,
        error: null,
      },
    };
  } catch (error) {
    console.error("Error in getServerSideProps:", error);
    return {
      props: {
        error: {
          type: "FETCH_MIX_ERROR",
          message: error.message,
        },
        initialMix: null,
        initialTracks: [],
        recentlyPlayedData: null,
        savedTracksData: null,
        topTracksData: null,
        accessToken,
      },
    };
  }
}

export default RadioMix;
