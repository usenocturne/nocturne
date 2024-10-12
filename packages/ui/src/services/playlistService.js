export const fetchUserPlaylists = async (accessToken, setPlaylists, updateGradientColors, handleError) => {
    try {
      const response = await fetch("https://api.spotify.com/v1/me/playlists", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        if (data.items.length > 0) {
          const imageUrl = data.items[0].images[0]?.url;
          if (imageUrl) {
            localStorage.setItem("libraryImage", imageUrl);
            updateGradientColors(imageUrl, "library");
          }
        }
        setPlaylists(data.items);
      } else {
        handleError("FETCH_USER_PLAYLISTS_ERROR", response.status.toString());
      }
    } catch (error) {
      handleError("FETCH_USER_PLAYLISTS_ERROR", error.message);
    }
  };