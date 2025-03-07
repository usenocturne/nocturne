import React, { useState, useEffect, useRef } from "react";
import { useSpotifyWebSocket } from "../../hooks/useSpotifyWebSocket";

const RecentsView = ({ accessToken }) => {
  const { currentPlayback } = useSpotifyWebSocket(accessToken);
  const [albumsQueue, setAlbumsQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const scrollContainerRef = useRef(null);

  useEffect(() => {
    if (!accessToken) return;

    const fetchRecentAlbums = async () => {
      try {
        setLoading(true);
        const response = await fetch(
          "https://api.spotify.com/v1/me/player/recently-played?limit=20",
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        if (response.ok) {
          const data = await response.json();
          const albums = data.items.map((item) => item.track.album);
          const uniqueAlbums = albums.filter(
            (album, index, self) =>
              index === self.findIndex((a) => a.id === album.id)
          );

          setAlbumsQueue(uniqueAlbums);
        }
      } catch (error) {
        console.error("Error fetching recent albums:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchRecentAlbums();
  }, [accessToken]);

  useEffect(() => {
    if (currentPlayback?.item?.album) {
      const currentAlbum = currentPlayback.item.album;

      setAlbumsQueue((prevQueue) => {
        const filteredQueue = prevQueue.filter(
          (album) => album.id !== currentAlbum.id
        );
        return [currentAlbum, ...filteredQueue];
      });
    }
  }, [currentPlayback]);

  useEffect(() => {
    const handleWheel = (e) => {
      if (scrollContainerRef.current) {
        e.preventDefault();
        scrollContainerRef.current.scrollLeft += e.deltaX;
      }
    };

    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener("wheel", handleWheel, {
        passive: false,
      });
    }

    return () => {
      if (scrollContainer) {
        scrollContainer.removeEventListener("wheel", handleWheel);
      }
    };
  }, []);

  if (loading && albumsQueue.length === 0) {
    return (
      <div className="pt-12 pl-2">
        <div className="animate-pulse">
          <div className="flex space-x-10 overflow-x-auto pb-8 scroll-container">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex-none">
                <div className="bg-white/10 h-[280px] w-[280px] rounded-xl mb-4"></div>
                <div className="h-10 bg-white/10 rounded w-52 mb-4"></div>
                <div className="h-8 bg-white/10 rounded w-40"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-12 pl-2">
      <div
        ref={scrollContainerRef}
        className="flex space-x-10 overflow-x-auto pb-8 scroll-container"
      >
        {albumsQueue.map((album) => {
          return (
            <div key={album.id} className="flex-none min-w-[280px]">
              <img
                src={album.images[0]?.url}
                alt={album.name}
                className="h-[280px] w-[280px] object-cover rounded-xl shadow-lg"
              />
              <h3 className="mt-2 text-[36px] font-[580] text-white truncate tracking-tight max-w-[280px]">
                {album.name}
              </h3>
              <p className="text-[28px] font-[560] text-white/60 truncate tracking-tight max-w-[280px]">
                {album.artists.map((artist) => artist.name).join(", ")}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default RecentsView;
