export const fetchUserRadio = async (accessToken, setRadio, updateGradientColors, handleError) => {
  try {
    const recentlyPlayedResponse = await fetch(
      "https://api.spotify.com/v1/me/player/recently-played?limit=50",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!recentlyPlayedResponse.ok) {
      throw new Error(`Failed to fetch recently played: ${recentlyPlayedResponse.status}`);
    }

    const recentlyPlayedData = await recentlyPlayedResponse.json();

    const savedTracksResponse = await fetch(
      "https://api.spotify.com/v1/me/tracks?limit=50",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!savedTracksResponse.ok) {
      throw new Error(`Failed to fetch saved tracks: ${savedTracksResponse.status}`);
    }

    const savedTracksData = await savedTracksResponse.json();

    const topTracksResponse = await fetch(
      "https://api.spotify.com/v1/me/top/tracks?time_range=long_term&limit=50",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!topTracksResponse.ok) {
      throw new Error(`Failed to fetch top tracks: ${topTracksResponse.status}`);
    }

    const topTracksData = await topTracksResponse.json();

    const topArtistsResponse = await fetch(
      "https://api.spotify.com/v1/me/top/artists?time_range=long_term&limit=20",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!topArtistsResponse.ok) {
      throw new Error(`Failed to fetch top artists: ${topArtistsResponse.status}`);
    }

    const recentlyPlayedMix = {
      id: 'recently-played-mix',
      name: 'Recent Mix',
      description: 'Your recently played tracks',
      images: [
        {
          url: "/images/radio-cover/recent.webp" || 'https://misc.scdn.co/liked-songs/liked-songs-640.png'
        }
      ],
      tracks: {
        items: recentlyPlayedData.items.map(item => ({ track: item.track })),
        total: recentlyPlayedData.items.length
      },
      external_urls: {
        spotify: `spotify:user:${recentlyPlayedData.items[0]?.track?.uri}`
      },
      owner: {
        display_name: 'Nocturne Radio'
      },
      type: 'playlist'
    };

    const topMix = {
      id: 'top-mix',
      name: 'Your Top Mix',
      description: 'Your most played tracks this year',
      images: [
        {
          url: "/images/radio-cover/top.webp" || 'https://misc.scdn.co/liked-songs/liked-songs-640.png'
        }
      ],
      tracks: {
        items: topTracksData.items.map(track => ({ track })),
        total: topTracksData.items.length
      },
      external_urls: {
        spotify: `spotify:user:${topTracksData.items[0]?.uri}`
      },
      owner: {
        display_name: 'Nocturne Radio'
      },
      type: 'playlist'
    };

    const playCountMap = new Map();
    recentlyPlayedData.items.forEach(item => {
      const trackId = item.track.id;
      playCountMap.set(trackId, (playCountMap.get(trackId) || 0) + 1);
    });

    const discoveries = recentlyPlayedData.items.filter(item => 
      playCountMap.get(item.track.id) <= 2
    );

    const recentDiscoveriesMix = {
      id: 'recent-discoveries-mix',
      name: 'Discoveries',
      description: 'New tracks you\'ve been exploring',
      images: [
        {
          url: "/images/radio-cover/discoveries.webp" || 'https://misc.scdn.co/liked-songs/liked-songs-640.png'
        }
      ],
      tracks: {
        items: discoveries.map(item => ({ track: item.track })),
        total: discoveries.length
      },
      external_urls: {
        spotify: `spotify:user:${discoveries[0]?.track?.uri}`
      },
      owner: {
        display_name: 'Nocturne Radio'
      },
      type: 'playlist'
    };

    const allTracks = [
      ...savedTracksData.items,
      ...recentlyPlayedData.items,
      ...topTracksData.items,
    ]
    .map(item => item?.track)
    .filter(track => 
      track && 
      track.album && 
      track.album.release_date && 
      !isNaN(new Date(track.album.release_date).getFullYear())
    );

    const tracksByDecade = allTracks.reduce((acc, track) => {
      try {
        const year = new Date(track.album.release_date).getFullYear();
        if (!year || isNaN(year)) return acc;
        
        const decade = Math.floor(year / 10) * 10;
        if (!acc[decade]) acc[decade] = [];
        if (!acc[decade].find(t => t.id === track.id)) {
          acc[decade].push(track);
        }
        return acc;
      } catch (err) {
        console.warn('Failed to process track for era mix:', err);
        return acc;
      }
    }, {});

    const decadeImages = {
      1940: "/images/radio-cover/1940s.webp",
      1950: "/images/radio-cover/1950s.webp",
      1960: "/images/radio-cover/1960s.webp",
      1970: "/images/radio-cover/1970s.webp",
      1980: "/images/radio-cover/1980s.webp",
      1990: "/images/radio-cover/1990s.webp",
      2000: "/images/radio-cover/2000s.webp",
      2010: "/images/radio-cover/2010s.webp",
      2020: "/images/radio-cover/2020s.webp"
    };

    const eraMixes = Object.entries(tracksByDecade)
      .filter(([_, tracks]) => tracks && tracks.length >= 10)
      .map(([decade, tracks]) => {
        try {
          const decadeNum = parseInt(decade);
          return {
            id: `era-mix-${decade}`,
            name: `${decade}s Mix`,
            description: `Your favorite tracks from the ${decade}s`,
            images: [
              {
                url: decadeImages[decadeNum] || "/images/not-playing.webp"
              }
            ],
            tracks: {
              items: tracks.map(track => ({ track })),
              total: tracks.length
            },
            external_urls: {
              spotify: tracks[0]?.external_urls?.spotify
            },
            owner: {
              display_name: 'Nocturne Radio'
            },
            type: 'playlist'
          };
        } catch (err) {
          console.warn('Failed to create era mix:', err);
          return null;
        }
      })
      .filter(Boolean);

    const allTracksForTempo = [
      ...savedTracksData.items,
      ...recentlyPlayedData.items,
      ...topTracksData.items,
    ].map(item => item?.track).filter(Boolean);

    const upbeatKeywords = [
      'dance', 'party', 'remix', 'club', 'beat', 'energy', 'fast', 'power',
      'rock', 'punk', 'metal', 'trap', 'edm', 'electro', 'house', 'techno'
    ];

    const chillKeywords = [
      'chill', 'relax', 'sleep', 'calm', 'acoustic', 'ambient', 'lo-fi',
      'lofi', 'slow', 'quiet', 'peace', 'mellow', 'soft', 'smooth', 'jazz'
    ];

    const isUpbeat = (track) => {
      const name = track.name.toLowerCase();
      const artistName = track.artists?.[0]?.name.toLowerCase() || '';
      return upbeatKeywords.some(keyword => 
        name.includes(keyword) || artistName.includes(keyword)
      );
    };

    const isChill = (track) => {
      const name = track.name.toLowerCase();
      const artistName = track.artists?.[0]?.name.toLowerCase() || '';
      return chillKeywords.some(keyword => 
        name.includes(keyword) || artistName.includes(keyword)
      );
    };

    const upbeatTracks = allTracksForTempo.filter(isUpbeat);
    const chillTracks = allTracksForTempo.filter(isChill);

    const upbeatMix = upbeatTracks.length >= 10 ? {
      id: 'upbeat-mix',
      name: 'Upbeat Mix',
      description: 'High energy tracks to get you moving',
      images: [
        {
          url: "/images/radio-cover/upbeat.webp" || 'https://misc.scdn.co/liked-songs/liked-songs-640.png'
        }
      ],
      tracks: {
        items: upbeatTracks.map(track => ({ track })),
        total: upbeatTracks.length
      },
      external_urls: {
        spotify: upbeatTracks[0]?.external_urls?.spotify
      },
      owner: {
        display_name: 'Nocturne Radio'
      },
      type: 'playlist'
    } : null;

    const chillMix = chillTracks.length >= 10 ? {
      id: 'chill-mix',
      name: 'Chill Mix',
      description: 'Relaxed tracks for laid-back moments',
      images: [
        {
          url: "/images/radio-cover/chill.webp" || 'https://misc.scdn.co/liked-songs/liked-songs-640.png'
        }
      ],
      tracks: {
        items: chillTracks.map(track => ({ track })),
        total: chillTracks.length
      },
      external_urls: {
        spotify: chillTracks[0]?.external_urls?.spotify
      },
      owner: {
        display_name: 'Nocturne Radio'
      },
      type: 'playlist'
    } : null;

    const hour = new Date().getHours();
    let timeOfDayMix = null;

    if (hour >= 5 && hour < 12) {
      timeOfDayMix = {
        id: 'morning-mix',
        name: 'Morning Mix',
        description: 'Perfect for your morning routine',
        images: [{ url: "/images/radio-cover/morning.webp" || 'https://misc.scdn.co/liked-songs/liked-songs-640.png' }],
        tracks: {
          items: savedTracksData.items.slice(0, 20),
          total: 20
        },
        external_urls: {
          spotify: savedTracksData.items[0]?.track?.external_urls?.spotify
        },
        owner: { display_name: 'Nocturne Radio' },
        type: 'playlist'
      };
    } else if (hour >= 12 && hour < 17) {
      timeOfDayMix = {
        id: 'afternoon-mix',
        name: 'Afternoon Mix',
        description: 'Energetic tracks to keep you going',
        images: [{ url: "/images/radio-cover/afternoon.webp" || 'https://misc.scdn.co/liked-songs/liked-songs-640.png' }],
        tracks: {
          items: topTracksData.items.slice(0, 20),
          total: 20
        },
        external_urls: {
          spotify: topTracksData.items[0]?.external_urls?.spotify
        },
        owner: { display_name: 'Nocturne Radio' },
        type: 'playlist'
      };
    } else {
      timeOfDayMix = {
        id: 'evening-mix',
        name: 'Evening Mix',
        description: 'Wind down with these tracks',
        images: [{ url: "/images/radio-cover/evening.webp" || 'https://misc.scdn.co/liked-songs/liked-songs-640.png' }],
        tracks: {
          items: recentlyPlayedData.items.slice(0, 20),
          total: 20
        },
        external_urls: {
          spotify: recentlyPlayedData.items[0]?.track?.external_urls?.spotify
        },
        owner: { display_name: 'Nocturne Radio' },
        type: 'playlist'
      };
    }

    const allMixes = [
      recentDiscoveriesMix,
      topMix,
      timeOfDayMix,
      recentlyPlayedMix,
      upbeatMix,
      chillMix,
      ...(eraMixes || []),
    ].filter(mix => mix && mix.tracks && mix.tracks.items && mix.tracks.items.length > 0);
    
    setRadio(allMixes);
    return allMixes.length > 0 ? allMixes[0].name : null;

  } catch (error) {
    console.error('Radio service error:', error);
    handleError("FETCH_USER_RADIO_ERROR", error.message);
    updateGradientColors(null, 'radio');
    return null;
  }
};