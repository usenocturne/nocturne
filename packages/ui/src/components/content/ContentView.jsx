import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useSpotifyPlayerControls } from "../../hooks/useSpotifyPlayerControls";
import { useSpotifyWebSocket } from "../../hooks/useSpotifyWebSocket";
import { useNavigation } from "../../hooks/useNavigation";
import { CarThingIcon } from "../common/icons";
import { useButtonMapping } from "../../hooks/useButtonMapping";
import ButtonMappingOverlay from "../common/overlays/ButtonMappingOverlay";
import ScrollingText from "../common/ScrollingText";
import SpotifyImage from "../common/SpotifyImage";

const ContentView = ({
  contentId,
  contentType = "album",
  onClose,
  currentlyPlayingTrackUri,
  currentPlayback,
  radioMixes = [],
  updateGradientColors,
  setIgnoreNextRelease,
  onNavigateToNowPlaying,
  refreshPlaybackState,
}) => {
  const [content, setContent] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedTrackIndex, setSelectedTrackIndex] = useState(-1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextUrl, setNextUrl] = useState(null);
  const [hasMoreTracks, setHasMoreTracks] = useState(false);
  const [tracksPerPage, setTracksPerPage] = useState(0);
  const [loadedPages, setLoadedPages] = useState(0);
  const tracksContainerRef = useRef(null);
  const navigate = useNavigate();

  const {
    playTrack,
    isLoading: isPlaybackLoading,
    error: playbackError,
  } = useSpotifyPlayerControls();

  const {
    getPlaylist,
    getPlaylistTracks,
    playTrackAtPosition,
    getPlayerState,
    toggleShuffle,
    setRepeatMode,
    wsConnected,
  } = useSpotifyWebSocket();

  const [isShuffleEnabled, setIsShuffleEnabled] = useState(false);
  const [isLazyLoading, setIsLazyLoading] = useState(false);
  const lazyLoadTimeoutRef = useRef(null);

  const tracksLengthRef = useRef(0);
  const isFetchingRef = useRef(false);

  const imageStyle = useMemo(() => {
    return contentType === "artist"
      ? "w-[280px] h-[280px] rounded-full drop-shadow-xl object-cover"
      : "w-[280px] h-[280px] object-cover rounded-[12px] drop-shadow-xl";
  }, [contentType]);

  const imageAlt = useMemo(() => {
    return `${content?.name || 'Unknown'} Cover`;
  }, [content?.name]);

  const containerStyle = useMemo(() => ({ minWidth: "280px" }), []);
  
  const scrollContainerStyle = useMemo(() => ({ 
    height: "calc(100vh - 5rem)", 
    paddingTop: "6px" 
  }), []);

  const titleStyle = useMemo(() => ({ 
    fontSize: "36px", 
    fontWeight: "580", 
    maxWidth: "280px" 
  }), []);

  const subtitleStyle = useMemo(() => ({ 
    fontSize: "28px", 
    fontWeight: "560", 
    maxWidth: "280px" 
  }), []);


  const handleColorsExtracted = useCallback((colors) => {
    if (colors && updateGradientColors) {
      updateGradientColors(colors, contentType);
    }
  }, [updateGradientColors, contentType]);

  const handleBack = useCallback(() => {
    if (onClose) {
      onClose();
    } else {
      navigate(-1);
    }
  }, [onClose, navigate]);

  const handleTrackSelect = useCallback((index, trackElement) => {
    if (index >= 0 && index < tracks.length) {
      const track = tracks[index];
      if (track) {
        handleTrackPlay(track, index);
      }
    }
  }, [tracks]);

  const { showMappingOverlay, activeButton, mappingInProgress, setTrackUris } =
    useButtonMapping({
      contentId,
      contentType,
      contentImage:
        content?.images?.[1]?.url || content?.images?.[0]?.url || "",
      contentName: content?.name || "",
      playTrack,
      isActive: !!content,
      setIgnoreNextRelease,
    });

  const { selectedIndex } = useNavigation({
    containerRef: tracksContainerRef,
    enableScrollTracking: true,
    enableWheelNavigation: true,
    enableKeyboardNavigation: true,
    enableItemSelection: true,
    enableEscapeKey: true,
    onEscape: handleBack,
    onItemSelect: handleTrackSelect,
    onItemFocus: (index) => setSelectedTrackIndex(index),
    inactivityTimeout: 3000,
    vertical: true,
  });
  
  const lazyLoadNextBatch = useCallback(async () => {
    if (
      contentType !== "playlist" ||
      isLazyLoading ||
      !content
    ) {
      return;
    }

    try {
      setIsLazyLoading(true);
      
      const data = await getPlaylistTracks(contentId, {
        offset: tracksLengthRef.current,
        limit: 50,
        fields: "offset,items(track(name,id,uri,artists(name,id)))"
      });
      
      if (data.items && data.items.length > 0) {
        const newTracks = data.items.map((item) => item.track);
        
        setTracks((prevTracks) => {
          const updatedTracks = [...prevTracks, ...newTracks];
          
          const currentTotal = updatedTracks.length;
          const playlistTotal = content?.tracks?.total || 0;
          const hasMore = currentTotal < playlistTotal;
          
          setHasMoreTracks(hasMore);
          return updatedTracks;
        });
        
        setNextUrl(data.next);
      }
    } catch (error) {
      console.error("Lazy loading failed:", error);
    } finally {
      setIsLazyLoading(false);
    }
  }, [contentType, isLazyLoading, content, contentId, getPlaylistTracks]);

  useEffect(() => {
    tracksLengthRef.current = tracks.length;
    
    
    if (
      content &&
      tracks.length > 0 &&
      contentType === "playlist" &&
      !isLazyLoading &&
      hasMoreTracks
    ) {
      if (lazyLoadTimeoutRef.current) {
        clearTimeout(lazyLoadTimeoutRef.current);
      }
      
      lazyLoadTimeoutRef.current = setTimeout(() => {
        lazyLoadNextBatch();
      }, 3000);
    }
  }, [tracks.length, content, contentType, isLazyLoading, hasMoreTracks, lazyLoadNextBatch]);

  const loadMoreTracks = useCallback(async () => {
    if (
      !nextUrl ||
      isLoadingMore ||
      (contentType !== "playlist" && contentType !== "show")
    )
      return;

    try {
      setIsLoadingMore(true);
      
      if (contentType === "playlist") {
        try {
          const offset = tracksLengthRef.current;
          
          const data = await getPlaylistTracks(contentId, {
            offset,
            limit: 50,
            fields: "offset,items(track(name,id,uri,artists(name,id)))"
          });
          
          const newTracks = data.items.map((item) => item.track);
          setTracks((prevTracks) => [...prevTracks, ...newTracks]);
          setNextUrl(data.next);
          setHasMoreTracks(!!data.next);
          setLoadedPages((prev) => prev + 1);
        } catch (error) {
          console.error("WebSocket load more tracks failed:", error);
          throw error;
        }
      } else {
        console.error("Load more tracks not implemented for content type:", contentType);
        return;
      }
    } catch (err) {
      console.error("Error loading more tracks:", err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [nextUrl, isLoadingMore, contentType, contentId, getPlaylistTracks]);

  useEffect(() => {
    const container = tracksContainerRef.current;
    if (
      !container ||
      (contentType !== "playlist" && contentType !== "show") ||
      tracksPerPage === 0
    )
      return;

    const handleScroll = () => {
      const trackElements = container.querySelectorAll("[data-track-index]");
      if (trackElements.length === 0) return;

      const containerRect = container.getBoundingClientRect();
      let currentVisibleTrackIndex = -1;

      for (let i = 0; i < trackElements.length; i++) {
        const trackRect = trackElements[i].getBoundingClientRect();
        const trackCenter = trackRect.top + trackRect.height / 2;
        const containerCenter = containerRect.top + containerRect.height / 2;

        if (trackCenter <= containerCenter) {
          currentVisibleTrackIndex = i;
        } else {
          break;
        }
      }

      if (currentVisibleTrackIndex >= 0) {
        const currentPage = Math.floor(
          currentVisibleTrackIndex / tracksPerPage,
        );
        const currentPageStart = currentPage * tracksPerPage;
        const currentPageMidpoint =
          currentPageStart + Math.floor(tracksPerPage / 2);

        const loadThreshold = Math.floor(tracksLengthRef.current * 0.8);
        if (
          currentVisibleTrackIndex >= loadThreshold &&
          hasMoreTracks &&
          !isLoadingMore &&
          !isLazyLoading
        ) {
          loadMoreTracks();
        }
      }
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [
    hasMoreTracks,
    isLoadingMore,
    isLazyLoading,
    loadMoreTracks,
    contentType,
  ]);


  useEffect(() => {
    if (
      tracks.length > 0 &&
      (contentType === "mix" || contentType === "liked-songs")
    ) {
      const trackUris = tracks
        .filter((track) => track && track.uri)
        .map((track) => track.uri);

      setTrackUris(trackUris);
    }
  }, [tracks, contentType, setTrackUris]);

  useEffect(() => {
    if (currentPlayback?.shuffle_state !== undefined) {
      setIsShuffleEnabled(currentPlayback.shuffle_state);
    }
  }, [currentPlayback?.shuffle_state]);




  useEffect(() => {
    if (contentType === "mix") return;
    
    console.log("WebSocket content useEffect triggered", {
      contentId,
      contentType,
      wsConnected,
      getPlaylist: !!getPlaylist,
      getPlaylistTracks: !!getPlaylistTracks,
      timestamp: Date.now()
    });
    
    const fetchWebSocketContent = async () => {
      if (!contentId && contentType !== "liked-songs") return;
      
      if (!wsConnected) {
        console.log("WebSocket not connected, skipping fetch");
        return;
      }
      
      if (isFetchingRef.current) {
        console.log("Already fetching, skipping duplicate request");
        return;
      }

      try {
        isFetchingRef.current = true;
        setIsLoading(true);
        setNextUrl(null);
        setHasMoreTracks(false);
        setIsLoadingMore(false);
        setTracksPerPage(0);
        setLoadedPages(0);

        let contentData;
        let tracksData = [];

        switch (contentType) {
          case "album": {
            // TODO: Implement WebSocket album fetching
            throw new Error("Album fetching via WebSocket not yet implemented");
          }

          case "playlist": {
            try {
              console.log("Fetching playlist data for:", contentId);
              const [playlistInfo, tracksResponse] = await Promise.all([
                getPlaylist(contentId, "images,name,tracks.total"),
                getPlaylistTracks(contentId, {
                  offset: 0,
                  limit: 50,
                  fields: "offset,items(track(name,id,uri,artists(name,id)))"
                })
              ]);
              console.log("Playlist data fetched successfully");

              contentData = playlistInfo;
              tracksData = tracksResponse.items.map((item) => item.track);
              
              const currentOffset = tracksResponse.offset || 0;
              const currentItems = tracksResponse.items?.length || 0;
              const totalTracks = playlistInfo.tracks?.total || 0;
              const hasMore = (currentOffset + currentItems) < totalTracks;

              setNextUrl(tracksResponse.next);
              setHasMoreTracks(hasMore);
              setTracksPerPage(tracksData.length);
              setLoadedPages(1);
            } catch (error) {
              console.error("WebSocket playlist fetch failed:", error);
              throw new Error(`Failed to fetch playlist via WebSocket: ${error.message}`);
            }
            break;
          }

          case "artist": {
            // TODO: Implement WebSocket artist fetching
            throw new Error("Artist fetching via WebSocket not yet implemented");
          }

          case "liked-songs": {
            // TODO: Implement WebSocket liked songs fetching
            throw new Error("Liked songs fetching via WebSocket not yet implemented");
          }

          case "show": {
            // TODO: Implement WebSocket show fetching
            throw new Error("Show fetching via WebSocket not yet implemented");
          }

          default:
            throw new Error(`Unsupported content type: ${contentType}`);
        }

        setContent(contentData);
        setTracks(tracksData);
      } catch (err) {
        console.error(`Error fetching ${contentType} data:`, err);
        setError(err.message);
      } finally {
        isFetchingRef.current = false;
        setIsLoading(false);
      }
    };

    fetchWebSocketContent();
    
    return () => {
      isFetchingRef.current = false;
      if (lazyLoadTimeoutRef.current) {
        clearTimeout(lazyLoadTimeoutRef.current);
      }
    };
  }, [contentId, contentType, wsConnected]);

  useEffect(() => {
    if (contentType !== "mix") return;
    
    console.log("Mix content useEffect triggered", {
      contentId,
      contentType,
      radioMixesLength: radioMixes?.length
    });
    
    const fetchMixContent = async () => {
      if (!contentId) return;

      try {
        setIsLoading(true);
        setNextUrl(null);
        setHasMoreTracks(false);
        setIsLoadingMore(false);
        setTracksPerPage(0);
        setLoadedPages(0);

        const foundMix = radioMixes.find((m) => m.id === contentId);

        if (foundMix) {
          const contentData = {
            ...foundMix,
            type: "mix",
            images: foundMix.images?.[1]
              ? foundMix.images
              : [foundMix.images?.[0], foundMix.images?.[0]],
          };

          if (
            contentData?.images &&
            contentData.images.length > 0 &&
            updateGradientColors
          ) {
            updateGradientColors(
              contentData.images[1]?.url || contentData.images[0].url,
              contentType,
            );
          }

          const tracksData = foundMix.tracks || [];
          
          setContent(contentData);
          setTracks(tracksData);
        } else {
          throw new Error(`Mix not found: ${contentId}`);
        }
      } catch (err) {
        console.error(`Error fetching mix data:`, err);
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchMixContent();
  }, [contentId, contentType, radioMixes, updateGradientColors]);


  const handleTrackPlay = async (track, index) => {
    if (!track || !track.uri) {
      console.warn("Attempted to play an invalid track:", track);
      return;
    }

    let contextUri = null;
    let uris = null;
    let success = false;
    let originalPlayerState = null;

    try {
      originalPlayerState = await getPlayerState();
    } catch (error) {
      console.warn("Could not get player state, proceeding without preserving settings:", error);
    }

    try {
      if (contentType === "playlist") {
        contextUri = `spotify:playlist:${contentId}`;
        success = await playTrackAtPosition(contextUri, index);
      } else if (contentType === "album") {
        contextUri = `spotify:album:${contentId}`;
        success = await playTrack(track.uri, contextUri);
      } else if (contentType === "artist") {
        uris = tracks.filter((t) => t && t.uri).map((t) => t.uri);
        const startIndex = index || 0;
        uris = uris.slice(startIndex).concat(uris.slice(0, startIndex));
        success = await playTrack(track.uri, null, uris);
      } else if (contentType === "show") {
        contextUri = `spotify:show:${contentId}`;
        success = await playTrack(track.uri, contextUri);
      } else if (contentType === "mix") {
        const currentMix = radioMixes.find((m) => m.id === contentId);
        if (currentMix && currentMix.type === "spotify-radio") {
          contextUri = currentMix.uri;
          success = await playTrack(track.uri, contextUri);
        } else {
          uris = tracks.filter((t) => t && t.uri).map((t) => t.uri);
          const startIndex = index || 0;
          uris = uris.slice(startIndex).concat(uris.slice(0, startIndex));
          success = await playTrack(track.uri, null, uris);
        }
        localStorage.setItem("currentPlayingMixId", contentId);
      } else if (contentType === "liked-songs") {
        uris = tracks.filter((t) => t && t.uri).map((t) => t.uri);
        const startIndex = index || 0;
        uris = uris.slice(startIndex).concat(uris.slice(0, startIndex));
        success = await playTrack(track.uri, null, uris);
        localStorage.setItem("playingLikedSongs", "true");
      }
    } catch (error) {
      console.error("Failed to play track:", error);
      success = false;
    }

    if (success) {
      if (refreshPlaybackState) {
        setTimeout(() => {
          refreshPlaybackState(true);
        }, 1000);
      }

      if (originalPlayerState) {
        setTimeout(async () => {
          try {
            if (originalPlayerState.shuffle_state !== undefined) {
              await toggleShuffle(originalPlayerState.shuffle_state);
            }
            
            if (originalPlayerState.repeat_state !== undefined) {
              await setRepeatMode(originalPlayerState.repeat_state);
            }
          } catch (error) {
            console.warn("Could not restore player settings:", error);
          }
        }, 500);
      }

      if (onNavigateToNowPlaying) {
        onNavigateToNowPlaying();
      }
    }
  };

  const handleShufflePlay = async () => {
    if (tracks.length === 0) {
      console.warn("No tracks available to shuffle play");
      return;
    }

    let contextUri = null;
    let uris = null;
    let originalPlayerState = null;

    try {
      originalPlayerState = await getPlayerState();
    } catch (error) {
      console.warn("Could not get player state, proceeding without preserving settings:", error);
    }

    if (contentType === "mix") {
      const currentMix = radioMixes.find((m) => m.id === contentId);
      if (currentMix && currentMix.type === "spotify-radio") {
        contextUri = currentMix.uri;
      } else {
        uris = tracks.filter((t) => t && t.uri).map((t) => t.uri);
      }
    } else {
      uris = tracks.filter((t) => t && t.uri).map((t) => t.uri);
    }

    if (contentType === "liked-songs") {
      localStorage.setItem("playingLikedSongs", "true");
    }

    const success = await playTrack(null, contextUri, uris);

    if (success && originalPlayerState) {
      setTimeout(async () => {
        try {
          if (originalPlayerState.shuffle_state !== undefined) {
            await toggleShuffle(originalPlayerState.shuffle_state);
          }
          
          if (originalPlayerState.repeat_state !== undefined) {
            await setRepeatMode(originalPlayerState.repeat_state);
          }
        } catch (error) {
          console.warn("Could not restore player settings:", error);
        }
      }, 500);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col md:flex-row pt-10 px-12 fadeIn-animation">
        <div className="md:w-1/3 sticky top-10 mb-8 md:mb-0 md:mr-8">
          <div className="mr-10" style={{ minWidth: "280px" }}>
            <div
              className="aspect-square bg-white/10 animate-pulse rounded-xl drop-shadow-xl"
              style={{ width: "280px", height: "280px", borderRadius: "12px" }}
            />
            <div
              className="mt-4 h-10 bg-white/10 animate-pulse rounded"
              style={{ width: "250px" }}
            />
            <div
              className="mt-3 h-8 bg-white/10 animate-pulse rounded"
              style={{ width: "200px" }}
            />
          </div>
        </div>
        <div
          className="md:w-2/3 md:pl-20"
          style={{ height: "calc(100vh - 5rem)" }}
        >
          {Array(5)
            .fill()
            .map((_, i) => (
              <div key={i} className="flex items-start mb-4">
                <div className="w-6 h-8 bg-white/10 animate-pulse rounded mr-12" />
                <div className="flex-grow">
                  <div
                    className="h-8 bg-white/10 animate-pulse rounded mb-2"
                    style={{ width: "250px" }}
                  />
                  <div
                    className="h-6 bg-white/10 animate-pulse rounded"
                    style={{ width: "200px" }}
                  />
                </div>
              </div>
            ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center text-white/70"
        style={{ height: "480px" }}
      >
        <CarThingIcon className="h-16 w-auto mb-2" />
        <h3
          className="text-white truncate tracking-tight"
          style={{ fontSize: "36px", fontWeight: "560" }}
        >
          Error Loading Content
        </h3>
        <p
          className="text-white/60 truncate tracking-tight"
          style={{ fontSize: "24px", fontWeight: "560" }}
        >
          {error}
        </p>
      </div>
    );
  }

  if (!content) {
    return null;
  }

  const getImageUrl = () => {
    if (!content.images || !content.images.length) {
      return "/images/not-playing.webp";
    }
    return content.images[1]?.url || content.images[0].url;
  };

  const formatNumber = (num) => {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  };

  const getSubtitle = () => {
    switch (contentType) {
      case "album":
        return content.artists?.map((artist) => artist.name).join(", ");
      case "artist":
        return `${formatNumber(content.followers?.total || 0)} Followers`;
      case "playlist":
        return `${formatNumber(content.tracks?.total || 0)} Songs`;
      case "liked-songs":
        return `${formatNumber(content.tracks?.total || 0)} Songs`;
      case "mix":
        return `${content.tracks?.length || 0} Tracks`;
      case "show":
        return content.publisher;
      default:
        return "";
    }
  };


  const getMappingStatusText = () => {
    if (mappingInProgress) {
      return (
        <div className="absolute top-0 left-0 right-0 bg-black/80 text-white py-2 px-4 text-center rounded-t-[12px]">
          <span className="text-lg font-medium">Mapping to button...</span>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex flex-col md:flex-row pt-10 px-12 fadeIn-animation">
      <div className="md:w-1/3 sticky top-10 mb-8 md:mb-0 md:mr-8">
        <div className="mr-10 relative" style={containerStyle}>
          <SpotifyImage
            images={content.images}
            preferredSizeIndex={1}
            alt={imageAlt}
            width={280}
            height={280}
            priority={8}
            extractColors={true}
            onColorsExtracted={handleColorsExtracted}
            className={imageStyle}
          />
          {getMappingStatusText()}
          <h4
            className="mt-2 text-white truncate tracking-tight"
            style={titleStyle}
          >
            {content.name}
          </h4>
          <h4
            className="text-white/60 truncate tracking-tight"
            style={subtitleStyle}
          >
            {getSubtitle()}
          </h4>
        </div>
      </div>

      <div
        className="md:w-2/3 md:pl-20 overflow-y-auto scroll-container scroll-smooth pb-12"
        style={scrollContainerStyle}
        ref={tracksContainerRef}
      >
        {tracks.map((track, index) => {
          if (!track) return null;

          return (
            <div
              key={`${track.id || "track"}-${index}`}
              className={`flex items-start mb-5 transition-transform duration-200 ease-out ${
                selectedTrackIndex === index ? "scale-105" : ""
              }`}
              onClick={() => (track.uri ? handleTrackPlay(track, index) : null)}
              style={{ transition: "transform 0.2s ease-out" }}
              data-track-index={index}
            >
              <div
                className="text-3xl font-semibold text-center text-white/60 mr-6 mt-3 flex justify-center"
                style={{
                  minWidth: "3rem",
                  fontSize: "32px",
                  fontWeight: "580",
                }}
              >
                {track.uri && track.uri === currentlyPlayingTrackUri ? (
                  <div className="w-5">
                    <section>
                      <div className="wave0"></div>
                      <div className="wave1"></div>
                      <div className="wave2"></div>
                      <div className="wave3"></div>
                    </section>
                  </div>
                ) : (
                  <p>{index + 1}</p>
                )}
              </div>

              <div className="flex-grow" style={{ marginTop: "-6px" }}>
                <div>
                  {selectedTrackIndex === index ? (
                    <div
                      style={{
                        fontSize: "32px",
                        fontWeight: "580",
                        maxWidth: "280px",
                      }}
                    >
                      <ScrollingText
                        text={track.name || "Unknown Track"}
                        className="text-white tracking-tight"
                        maxWidth="280px"
                        pauseDuration={1000}
                        pixelsPerSecond={40}
                      />
                    </div>
                  ) : (
                    <p
                      className="text-white truncate tracking-tight"
                      style={{
                        fontSize: "32px",
                        fontWeight: "580",
                        maxWidth: "280px",
                      }}
                    >
                      {track.name || "Unknown Track"}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap">
                  {contentType === "show" ? (
                    <p
                      className="text-white/60 truncate tracking-tight"
                      style={{ fontSize: "28px", fontWeight: "560" }}
                    >
                      {track.release_date
                        ? new Date(track.release_date).toLocaleDateString(
                            "en-US",
                            {
                              year: "numeric",
                              month: "long",
                              day: "numeric",
                            },
                          )
                        : "No release date available"}
                    </p>
                  ) : (
                    track.artists &&
                    track.artists.map((artist, artistIndex) => (
                      <p
                        key={artist?.id || `artist-${artistIndex}`}
                        className={`text-white/60 truncate tracking-tight ${
                          artistIndex < track.artists.length - 1 ? "mr-2" : ""
                        }`}
                        style={{ fontSize: "28px", fontWeight: "560" }}
                      >
                        {artist?.name === null && artist?.type
                          ? artist.type
                          : artist?.name || "Unknown Artist"}
                        {artistIndex < track.artists.length - 1 && ","}
                      </p>
                    ))
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {isLoadingMore &&
          (contentType === "playlist" || contentType === "show") && (
            <div className="flex justify-center items-center py-8">
              <div className="flex items-center">
                <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin mr-4"></div>
                <p
                  className="text-white/60"
                  style={{ fontSize: "24px", fontWeight: "560" }}
                >
                  Loading more {contentType === "show" ? "episodes" : "tracks"}
                  ...
                </p>
              </div>
            </div>
          )}

        {isLazyLoading && contentType === "playlist" && (
          <div className="flex justify-center items-center py-2">
            <div className="flex items-center opacity-60">
              <div className="w-3 h-3 border border-white/20 border-t-white/40 rounded-full animate-spin mr-2"></div>
              <p
                className="text-white/40"
                style={{ fontSize: "16px", fontWeight: "400" }}
              >
                Loading...
              </p>
            </div>
          </div>
        )}

        {playbackError && (
          <div className="mt-4 p-4 bg-red-500/20 rounded-lg">
            <p className="text-white/80">{playbackError}</p>
          </div>
        )}
      </div>

      <ButtonMappingOverlay
        show={showMappingOverlay}
        activeButton={activeButton}
      />
    </div>
  );
};

export default ContentView;
