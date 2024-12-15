export const fetchUserOwnedPlaylists = async (
  accessToken,
  handleError = (code, message) => console.error(`${code}: ${message}`)
) => {
  try {
    const userResponse = await fetch("https://api.spotify.com/v1/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!userResponse.ok) {
      console.error("Error fetching user data:", userResponse.status);
      return [];
    }
    const userData = await userResponse.json();
    const userId = userData.id;

    const playlistsResponse = await fetch(
      "https://api.spotify.com/v1/me/playlists",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    if (playlistsResponse.ok) {
      const data = await playlistsResponse.json();
      const userOwnedPlaylists = data.items.filter(
        (playlist) => playlist && playlist.owner && playlist.owner.id === userId
      );

      if (userOwnedPlaylists.length > 0) {
        const imageUrl = userOwnedPlaylists[0].images[0]?.url;
        if (imageUrl) {
          localStorage.setItem("libraryImage", imageUrl);
        }
      }
      return userOwnedPlaylists;
    } else {
      console.error("Error fetching user playlists:", playlistsResponse.status);
      return [];
    }
  } catch (error) {
    console.error("Error fetching user playlists:", error.message);
    return [];
  }
};
