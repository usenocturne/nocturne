export const fetchUserRadio = async (accessToken, setRadio, updateGradientColors, handleError) => {
    try {
      const response = await fetch(
        "https://api.spotify.com/v1/browse/categories/0JQ5DAt0tbjZptfcdMSKl3/playlists",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        const playlists = data.playlists.items;

        const filteredPlaylists = playlists.filter(
          (playlist) => playlist.id !== "37i9dQZF1EYkqdzj48dyYq"
        );

        const priorityOrder = ["On Repeat", "Repeat Rewind"];

        const sortedPlaylists = filteredPlaylists.sort((a, b) => {
          const indexA = priorityOrder.indexOf(a.name);
          const indexB = priorityOrder.indexOf(b.name);

          if (indexA !== -1 && indexB !== -1) {
            return indexA - indexB;
          }
          if (indexA !== -1) {
            return -1;
          }
          if (indexB !== -1) {
            return 1;
          }
          return 0;
        });

        setRadio(sortedPlaylists);

        return sortedPlaylists.length > 0 ? sortedPlaylists[0].name : null;
      } else {
        handleError("FETCH_USER_RADIO_ERROR", response.status.toString());
        return null;
      }
    } catch (error) {
      handleError("FETCH_USER_RADIO_ERROR", error.message);
      return null;
    }
  };