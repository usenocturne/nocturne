export const fetchUserRadio = async (accessToken, setRadio, handleError) => {
  try {
    const mixes = [];
    
    const getSeasonInfo = () => {
      const now = new Date();
      const month = now.getMonth();
      const currentYear = now.getFullYear();
      const lastYear = currentYear - 1;
      
      if (month >= 2 && month <= 4) {
        return {
          id: 'spring-mix',
          name: 'Spring Mix',
          images: [{ url: '/images/radio-cover/spring.webp' }],
          sortOrder: 6,
          dateRanges: [
            { start: `${lastYear}-03-01`, end: `${lastYear}-05-31` },
            { start: `${currentYear}-03-01`, end: `${currentYear}-05-31` }
          ]
        };
      } else if (month >= 5 && month <= 7) {
        return {
          id: 'summer-mix',
          name: 'Summer Mix',
          images: [{ url: '/images/radio-cover/summer.webp' }],
          sortOrder: 6,
          dateRanges: [
            { start: `${lastYear}-06-01`, end: `${lastYear}-08-31` },
            { start: `${currentYear}-06-01`, end: `${currentYear}-08-31` }
          ]
        };
      } else if (month >= 8 && month <= 10) {
        return {
          id: 'fall-mix',
          name: 'Fall Mix',
          images: [{ url: '/images/radio-cover/fall.webp' }],
          sortOrder: 6,
          dateRanges: [
            { start: `${lastYear}-09-01`, end: `${lastYear}-11-30` },
            { start: `${currentYear}-09-01`, end: `${currentYear}-11-30` }
          ]
        };
      } else {
        return {
          id: 'winter-mix',
          name: 'Winter Mix',
          images: [{ url: '/images/radio-cover/winter.webp' }],
          sortOrder: 6,
          dateRanges: [
            { start: `${lastYear}-12-01`, end: `${lastYear}-02-28` },
            { start: `${currentYear}-12-01`, end: `${currentYear}-02-28` }
          ]
        };
      }
    };
    
    let topTracksData = null;
    
    const topTracksResponse = await fetch(
      "https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=medium_term",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    
    if (topTracksResponse.ok) {
      topTracksData = await topTracksResponse.json();
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
        sortOrder: 3,
        timeRange: { start: 5, end: 12 }
      };
    } else if (hour >= 12 && hour < 17) {
      timeMix = {
        id: 'afternoon-mix',
        name: 'Afternoon Mix',
        images: [{ url: '/images/radio-cover/afternoon.webp' }],
        type: 'time',
        sortOrder: 3,
        timeRange: { start: 12, end: 17 }
      };
    } else {
      timeMix = {
        id: 'evening-mix',
        name: 'Evening Mix',
        images: [{ url: '/images/radio-cover/evening.webp' }],
        type: 'time',
        sortOrder: 3,
        timeRange: { start: 17, end: 5 }
      };
    }

    const [playHistoryResponse, mediumTermTracks, longTermTracks] = await Promise.all([
      fetch(
        "https://api.spotify.com/v1/me/player/recently-played?limit=50",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      ),
      fetch(
        "https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=medium_term",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      ).then(res => res.ok ? res.json() : null),
      fetch(
        "https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=long_term",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      ).then(res => res.ok ? res.json() : null)
    ]);

    if (playHistoryResponse.ok && mediumTermTracks && longTermTracks) {
      const playHistoryData = await playHistoryResponse.json();
      
      const trackPlayMap = new Map();
      
      playHistoryData.items.forEach(item => {
        const playedHour = new Date(item.played_at).getHours();
        const trackId = item.track.id;
        
        if (!trackPlayMap.has(trackId)) {
          trackPlayMap.set(trackId, {
            track: item.track,
            playTimes: new Set(),
            count: 0
          });
        }
        
        const trackData = trackPlayMap.get(trackId);
        trackData.playTimes.add(playedHour);
        trackData.count++;
      });

      const allTracks = [
        ...mediumTermTracks.items.map(track => ({ ...track, weight: 0.6 })),
        ...longTermTracks.items.map(track => ({ ...track, weight: 0.4 }))
      ];

      const scoredTracks = allTracks.map(track => {
        const playData = trackPlayMap.get(track.id);
        let timeScore = 0;
        
        if (playData) {
          const relevantHours = Array.from(playData.playTimes).filter(hour => {
            if (timeMix.timeRange.start < timeMix.timeRange.end) {
              return hour >= timeMix.timeRange.start && hour < timeMix.timeRange.end;
            } else {
              return hour >= timeMix.timeRange.start || hour < timeMix.timeRange.end;
            }
          });
          
          timeScore = (relevantHours.length / playData.playTimes.size) * playData.count;
        }
        
        return {
          ...track,
          timeScore: timeScore * (track.weight || 1)
        };
      });

      const timeSortedTracks = scoredTracks
        .sort((a, b) => b.timeScore - a.timeScore)
        .slice(0, 50);

      if (timeSortedTracks.length < 50) {
        const remainingTracks = allTracks
          .filter(track => !timeSortedTracks.some(t => t.id === track.id))
          .sort(() => Math.random() - 0.5)
          .slice(0, 50 - timeSortedTracks.length);
        
        timeSortedTracks.push(...remainingTracks);
      }

      timeMix.tracks = timeSortedTracks;
      mixes.push(timeMix);

      const seasonalInfo = getSeasonInfo();
      const weightedTracks = [
        ...mediumTermTracks.items.map(track => ({
          ...track,
          weight: 0.6
        })),
        ...longTermTracks.items.map(track => ({
          ...track,
          weight: 0.4
        }))
      ];

      const uniqueTracks = Array.from(
        weightedTracks.reduce((map, track) => {
          const existing = map.get(track.id);
          if (!existing || existing.weight < track.weight) {
            map.set(track.id, track);
          }
          return map;
        }, new Map())
      ).map(([_, track]) => track);

      const seasonalTracks = uniqueTracks
        .sort(() => Math.random() - 0.5)
        .slice(0, 50);

      mixes.push({
        ...seasonalInfo,
        tracks: seasonalTracks,
        type: 'seasonal'
      });
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

    const throwbackResponse = await fetch(
      "https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=long_term",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    
    if (throwbackResponse.ok) {
      const throwbackData = await throwbackResponse.json();
      const uniqueThrowbackTracks = topTracksData 
        ? throwbackData.items.filter(
            track => !topTracksData.items.some(topTrack => topTrack.id === track.id)
          )
        : throwbackData.items;
      
      mixes.push({
        id: 'throwback-mix',
        name: 'Throwbacks',
        images: [{ url: '/images/radio-cover/throwback.webp' }],
        tracks: uniqueThrowbackTracks,
        type: 'static',
        sortOrder: 5
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