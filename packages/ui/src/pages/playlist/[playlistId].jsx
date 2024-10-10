import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import LongPressLink from "../../components/LongPressLink";

const PlaylistPage = ({ playlist, currentlyPlayingTrackUri }) => {
  const router = useRouter();
  const accessToken = router.query.accessToken;
  const [isShuffleEnabled, setIsShuffleEnabled] = useState(false);

  useEffect(() => {
    const playlistImage =
      playlist.images && playlist.images.length > 0
        ? playlist.images[0].url
        : "";
    localStorage.setItem("playlistPageImage", playlistImage);
  }, [playlist]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Enter") {
        playPlaylist();
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
        console.error("Error fetching playback state:", error);
      }
    };

    fetchPlaybackState();
  }, [accessToken]);

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
        console.error("No devices available for playback");
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
    } catch (error) {
      console.error("Error playing playlist:", error);
    }
  };

  const playTrack = async (trackUri, trackIndex) => {
    const accessToken = router.query.accessToken;

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
        console.error("No devices available for playback");
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
          console.error("Error transferring playback:", errorData);
          return;
        }
      }

      const trackUris = playlist.tracks.items.map((item) => item.track.uri);

      const playResponse = await fetch(
        "https://api.spotify.com/v1/me/player/play",
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            uris: trackUris,
            offset: {
              position: trackIndex,
            },
            device_id: activeDeviceId,
          }),
        }
      );

      if (!playResponse.ok) {
        const errorData = await playResponse.json();
        console.error("Error playing track:", errorData);
      }
    } catch (error) {
      console.error("Error with playTrack request:", error);
    }
  };

  return (
    <div className="flex flex-col md:flex-row gap-8 pt-10 px-12 max-h-screen">
      <div className="md:w-1/3 h-screen sticky top-0">
        {playlist.images && playlist.images.length > 0 ? (
          <div className="min-w-[280px] mr-10">
            <LongPressLink
              href={`/`}
              spotifyUrl={playlist.external_urls.spotify}
              accessToken={accessToken}
            >
              <img
                src={playlist.images[0].url}
                alt="Playlist Cover"
                className="w-[280px] h-[280px] aspect-square rounded-[12px] drop-shadow-xl"
              />
            </LongPressLink>
            <LongPressLink
              href={`/`}
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

      <div className="md:w-2/3 ml-20 h-screen overflow-y-scroll scroll-container pb-12">
        {playlist.tracks && playlist.tracks.items ? (
          playlist.tracks.items.map((item, index) => (
            <div key={item.track.id} className="flex gap-12 items-start mb-4">
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
                      href={`/artist/${artist.id}`}
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
          ))
        ) : (
          <p>No tracks available</p>
        )}
      </div>
    </div>
  );
};

export async function getServerSideProps(context) {
  const { playlistId } = context.params;
  const accessToken = context.query.accessToken;

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
    console.error("Error fetching playlist:", errorData);
    return {
      notFound: true,
    };
  }

  const playlistData = await res.json();

  async function fetchAllTracks(url) {
    let allTracks = [];
    let nextUrl = url;

    while (nextUrl) {
      const response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        console.error("Error fetching tracks:", await response.json());
        break;
      }

      const data = await response.json();
      allTracks = allTracks.concat(data.items);
      nextUrl = data.next;
    }

    return allTracks;
  }

  const allTracks = await fetchAllTracks(playlistData.tracks.href);

  const updatedPlaylist = {
    ...playlistData,
    tracks: {
      ...playlistData.tracks,
      items: allTracks,
      total: allTracks.length,
    },
  };

  return {
    props: {
      playlist: updatedPlaylist,
      accessToken,
    },
  };
}

export default PlaylistPage;
