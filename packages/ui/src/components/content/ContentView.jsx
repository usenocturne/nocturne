import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

const ContentView = ({
  accessToken,
  contentId,
  contentType = "album",
  onClose,
  currentlyPlayingTrackUri,
  radioMixes = [],
}) => {
  const [content, setContent] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const tracksContainerRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchContent = async () => {
      if (!accessToken) return;
      if (!contentId && contentType !== "liked-songs") return;

      try {
        setIsLoading(true);
        let contentData;
        let tracksData = [];

        switch (contentType) {
          case "album": {
            const albumResponse = await fetch(
              `https://api.spotify.com/v1/albums/${contentId}`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              }
            );

            if (!albumResponse.ok) {
              throw new Error(
                `Failed to fetch album data: ${albumResponse.status}`
              );
            }

            contentData = await albumResponse.json();

            const albumTracksResponse = await fetch(
              `https://api.spotify.com/v1/albums/${contentId}/tracks?limit=50`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              }
            );

            if (!albumTracksResponse.ok) {
              throw new Error(
                `Failed to fetch album tracks: ${albumTracksResponse.status}`
              );
            }

            tracksData = (await albumTracksResponse.json()).items;
            break;
          }

          case "artist": {
            const artistResponse = await fetch(
              `https://api.spotify.com/v1/artists/${contentId}`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              }
            );

            if (!artistResponse.ok) {
              throw new Error(
                `Failed to fetch artist data: ${artistResponse.status}`
              );
            }

            contentData = await artistResponse.json();

            const artistTracksResponse = await fetch(
              `https://api.spotify.com/v1/artists/${contentId}/top-tracks?market=from_token`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              }
            );

            if (!artistTracksResponse.ok) {
              throw new Error(
                `Failed to fetch artist tracks: ${artistTracksResponse.status}`
              );
            }

            tracksData = (await artistTracksResponse.json()).tracks;
            break;
          }

          case "playlist": {
            const playlistResponse = await fetch(
              `https://api.spotify.com/v1/playlists/${contentId}`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              }
            );

            if (!playlistResponse.ok) {
              throw new Error(
                `Failed to fetch playlist data: ${playlistResponse.status}`
              );
            }

            contentData = await playlistResponse.json();

            tracksData = contentData.tracks.items.map((item) => item.track);
            break;
          }

          case "liked-songs": {
            const likedSongsResponse = await fetch(
              "https://api.spotify.com/v1/me/tracks?limit=50",
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              }
            );

            if (!likedSongsResponse.ok) {
              throw new Error(
                `Failed to fetch liked songs: ${likedSongsResponse.status}`
              );
            }

            const likedSongsData = await likedSongsResponse.json();

            contentData = {
              id: "liked-songs",
              name: "Liked Songs",
              type: "liked-songs",
              images: [
                { url: "https://misc.scdn.co/liked-songs/liked-songs-640.png" },
              ],
              tracks: { total: likedSongsData.total },
              owner: { display_name: "You" },
            };

            tracksData = likedSongsData.items.map((item) => item.track);
            break;
          }

          case "mix": {
            const foundMix = radioMixes.find((m) => m.id === contentId);

            if (foundMix) {
              contentData = {
                ...foundMix,
                type: "mix",
              };

              tracksData = foundMix.tracks || [];
            } else {
              throw new Error(`Mix not found: ${contentId}`);
            }
            break;
          }

          default:
            throw new Error(`Unsupported content type: ${contentType}`);
        }

        setContent(contentData);
        setTracks(tracksData);
      } catch (err) {
        console.error(`Error fetching ${contentType} data:`, err);
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchContent();
  }, [contentId, contentType, accessToken]);

  const handleBack = () => {
    if (onClose) {
      onClose();
    } else {
      navigate(-1);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        handleBack();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  if (isLoading) {
    return (
      <div className="flex flex-col md:flex-row gap-8 pt-10 px-12 fadeIn-animation">
        <div className="md:w-1/3 sticky top-10">
          <div className="min-w-[280px] mr-10">
            <div className="aspect-square rounded-[12px] drop-shadow-xl bg-white/10 animate-pulse w-[280px] h-[280px]" />
            <div className="mt-4 h-10 bg-white/10 animate-pulse w-[250px] rounded" />
            <div className="mt-3 h-8 bg-white/10 animate-pulse w-[200px] rounded" />
          </div>
        </div>
        <div className="md:w-2/3 pl-20 h-[calc(100vh-5rem)]">
          {Array(5)
            .fill()
            .map((_, i) => (
              <div key={i} className="flex gap-12 items-start mb-4">
                <div className="w-6 h-8 bg-white/10 animate-pulse rounded" />
                <div className="flex-grow">
                  <div className="h-8 bg-white/10 animate-pulse w-[250px] rounded mb-2" />
                  <div className="h-6 bg-white/10 animate-pulse w-[200px] rounded" />
                </div>
              </div>
            ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-5rem)] text-white/70">
        <h3 className="text-2xl mb-4">Error loading content</h3>
        <p>{error}</p>
      </div>
    );
  }

  if (!content) {
    return null;
  }

  const getImageUrl = () => {
    if (!content.images || !content.images.length) {
      return "/images/not-playing.webp";
    }
    return content.images[0].url;
  };

  const getSubtitle = () => {
    switch (contentType) {
      case "album":
        return content.artists?.map((artist) => artist.name).join(", ");
      case "artist":
        return `${content.followers?.total?.toLocaleString() || 0} Followers`;
      case "playlist":
        return `${content.tracks?.total || 0} Songs`;
      case "liked-songs":
        return `${content.tracks?.total || 0} Songs`;
      case "mix":
        return `${content.tracks?.length || 0} Tracks`;
      default:
        return "";
    }
  };

  const getImageStyle = () => {
    return contentType === "artist"
      ? "aspect-square rounded-full drop-shadow-xl object-cover"
      : "aspect-square rounded-[12px] drop-shadow-xl";
  };

  return (
    <div className="flex flex-col md:flex-row gap-8 pt-10 px-12 fadeIn-animation">
      <div className="md:w-1/3 sticky top-10">
        <div className="min-w-[280px] mr-10">
          <img
            src={getImageUrl()}
            alt={`${content.name} Cover`}
            width={280}
            height={280}
            className={getImageStyle()}
          />
          <h4 className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]">
            {content.name}
          </h4>
          <h4 className="text-[28px] font-[560] text-white/60 truncate tracking-tight max-w-[280px]">
            {getSubtitle()}
          </h4>
        </div>
      </div>

      <div
        className="md:w-2/3 pl-20 h-[calc(100vh-5rem)] overflow-y-auto scroll-container scroll-smooth pb-12"
        ref={tracksContainerRef}
      >
        {tracks.map((track, index) => (
          <div
            key={track.id}
            className="flex gap-12 items-start mb-4 transition-transform duration-200 ease-out"
            style={{ transition: "transform 0.2s ease-out" }}
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
              <div className="cursor-pointer">
                <p className="text-[32px] font-[580] text-white truncate tracking-tight max-w-[280px]">
                  {track.name}
                </p>
              </div>
              <div className="flex flex-wrap">
                {track.artists &&
                  track.artists.map((artist, artistIndex) => (
                    <p
                      key={artist.id}
                      className={`text-[28px] font-[560] text-white/60 truncate tracking-tight ${
                        artistIndex < track.artists.length - 1
                          ? 'mr-2 after:content-[","]'
                          : ""
                      }`}
                    >
                      {artist.name}
                    </p>
                  ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ContentView;
