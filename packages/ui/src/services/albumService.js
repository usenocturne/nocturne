export const fetchRecentlyPlayedAlbums = async (accessToken, setAlbums, setAlbumsQueue, handleError) => {
    if (accessToken) {
      try {
        const response = await fetch(
          "https://api.spotify.com/v1/me/player/recently-played",
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        if (response.ok) {
          const data = await response.json();
          const albums = data.items.map((item) => item.track.album);

          setAlbums(albums);

          setAlbumsQueue((prevQueue) => {
            const uniqueAlbums = [...prevQueue, ...albums].filter(
              (album, index, self) =>
                index === self.findIndex((a) => a.id === album.id)
            );
            return uniqueAlbums;
          });
        } else {
          console.error("Error fetching recently played albums:", response.status);
        }
      } catch (error) {
        console.error("Error fetching recently played albums:", error.message);
      }
    }
  };