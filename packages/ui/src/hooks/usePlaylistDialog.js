import { useState, useEffect } from "react";
import { fetchUserOwnedPlaylists } from "../services/userPlaylistService";

export function usePlaylistDialog({ accessToken, currentPlayback }) {
  const [open, setOpen] = useState(false);
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(null);

  useEffect(() => {
    const fetchPlaylists = async () => {
      if (accessToken) {
        try {
          const userPlaylists = await fetchUserOwnedPlaylists(accessToken);
          setPlaylists(userPlaylists);
        } catch (error) {
          console.error("Error fetching user playlists:", error);
        }
      }
    };

    fetchPlaylists();
  }, [accessToken]);

  const addTrackToPlaylist = async (playlistId) => {
    if (!accessToken || !currentPlayback?.item) return;

    setSelectedPlaylistId(playlistId);

    try {
      let allTracks = [];
      let nextURL = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`;

      while (nextURL) {
        const response = await fetch(nextURL, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (!response.ok) {
          throw new Error("Error fetching tracks in playlist");
        }

        const data = await response.json();
        allTracks = allTracks.concat(data.items);
        nextURL = data.next;
      }

      const currentTrackIds = allTracks.map((item) => item.track.id);

      if (currentTrackIds.includes(currentPlayback.item.id)) {
        setOpen(true);
        return;
      }

      await addTrackToPlaylistAPI(playlistId);
    } catch (error) {
      console.error("Error checking playlist contents:", error);
    }
  };

  const addTrackToPlaylistAPI = async (playlistId) => {
    try {
      const response = await fetch(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            uris: [`spotify:track:${currentPlayback.item.id}`],
          }),
        }
      );

      if (!response.ok) {
        console.error("Error adding track to playlist:", response.status);
      }
    } catch (error) {
      console.error("Error adding track to playlist:", error);
    }
  };

  const handleAddAnyway = () => {
    setOpen(false);
    if (selectedPlaylistId) {
      addTrackToPlaylistAPI(selectedPlaylistId);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setSelectedPlaylistId(null);
  };

  return {
    open,
    setOpen,
    playlists,
    selectedPlaylistId,
    addTrackToPlaylist,
    handleAddAnyway,
    handleClose,
  };
}
