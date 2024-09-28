export const fetchUserPlaylists = async (accessToken, setPlaylists, updateGradientColors) => {
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
        console.error("Error fetching user playlists:", response.status);
      }
    } catch (error) {
      console.error("Error fetching user playlists:", error);
    }
  };