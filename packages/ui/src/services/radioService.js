export const fetchUserRadio = async (accessToken, setRadio, handleError) => {
  try {
    const mixes = [];
    
    const topTracksResponse = await fetch(
      "https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=medium_term",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    
    if (topTracksResponse.ok) {
      const topTracksData = await topTracksResponse.json();
      mixes.push({
        id: 'top-mix',
        name: 'Your Top Mix',
        images: [{ url: '/images/radio-cover/top.webp' }],
        tracks: topTracksData.items,
        type: 'static',
        sortOrder: 1
      });
    }
    
    const recentResponse = await fetch(
      "https://api.spotify.com/v1/me/player/recently-played?limit=50",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    
    if (recentResponse.ok) {
      const recentData = await recentResponse.json();
      mixes.push({
        id: 'recent-mix',
        name: 'Recent Mix',
        images: [{ url: '/images/radio-cover/recent.webp' }],
        tracks: recentData.items.map(item => item.track),
        type: 'static',
        sortOrder: 4
      });
    }
    
    const hour = new Date().getHours();
    let timeMix;
    
    if (hour >= 5 && hour < 12) {
      timeMix = {
        id: 'morning-mix',
        name: 'Morning Mix',
        images: [{ url: '/images/radio-cover/morning.webp' }],
        type: 'time',
        sortOrder: 3
      };
    } else if (hour >= 12 && hour < 17) {
      timeMix = {
        id: 'afternoon-mix',
        name: 'Afternoon Mix',
        images: [{ url: '/images/radio-cover/afternoon.webp' }],
        type: 'time',
        sortOrder: 3
      };
    } else {
      timeMix = {
        id: 'evening-mix',
        name: 'Evening Mix',
        images: [{ url: '/images/radio-cover/evening.webp' }],
        type: 'time',
        sortOrder: 3
      };
    }
    
    const playHistoryResponse = await fetch(
      "https://api.spotify.com/v1/me/player/recently-played?limit=50",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    
    if (playHistoryResponse.ok) {
      const playHistoryData = await playHistoryResponse.json();
      const timeFilteredTracks = playHistoryData.items.filter(item => {
        const playedHour = new Date(item.played_at).getHours();
        if (timeMix.id === 'morning-mix') {
          return playedHour >= 5 && playedHour < 12;
        } else if (timeMix.id === 'afternoon-mix') {
          return playedHour >= 12 && playedHour < 17;
        } else {
          return playedHour >= 17 || playedHour < 5;
        }
      });
      
      timeMix.tracks = timeFilteredTracks.map(item => item.track);
      mixes.push(timeMix);
    }

    const topArtistsResponse = await fetch(
      "https://api.spotify.com/v1/me/top/artists?limit=10",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    
    if (topArtistsResponse.ok) {
      const topArtistsData = await topArtistsResponse.json();
      const artistTracks = await Promise.all(
        topArtistsData.items.map(artist =>
          fetch(`https://api.spotify.com/v1/artists/${artist.id}/top-tracks?market=US`, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }).then(res => res.json())
        )
      );
      
      const allArtistTracks = artistTracks
        .flatMap(response => response.tracks)
        .sort(() => Math.random() - 0.5)
        .slice(0, 50);
      
      mixes.push({
        id: 'discoveries-mix',
        name: 'Discoveries',
        images: [{ url: '/images/radio-cover/discoveries.webp' }],
        tracks: allArtistTracks,
        type: 'static',
        sortOrder: 2
      });
    }

    const sortedMixes = mixes.sort((a, b) => a.sortOrder - b.sortOrder);
    
    setRadio(sortedMixes);
    return mixes.length > 0 ? mixes[0].name : null;
    
  } catch (error) {
    handleError("FETCH_USER_RADIO_ERROR", error.message);
    return null;
  }
};