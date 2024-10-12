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
          handleError("FETCH_RECENTLY_PLAYED_ALBUMS_ERROR", response.status.toString());
        }
      } catch (error) {
        handleError("FETCH_RECENTLY_PLAYED_ALBUMS_ERROR", error.message);
      }
    }
  };