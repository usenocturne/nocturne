import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useSpotifyPlayerControls } from "../../hooks/useSpotifyPlayerControls";
import { useSpotifyWebSocket } from "../../hooks/useSpotifyWebSocket";
import { useNavigation } from "../../hooks/useNavigation";
import {
  AlertCircleIcon,
  CarThingIcon,
  CheckCircleIcon,
  PlaylistAddIcon,
} from "../common/icons";
import { useButtonMapping } from "../../hooks/useButtonMapping";
import ButtonMappingOverlay from "../common/overlays/ButtonMappingOverlay";
import ScrollingText from "../common/ScrollingText";
import SpotifyImage from "../common/SpotifyImage";
import { extractColorsFromImage } from "../../utils/colorExtractor";
import {
  getQueueSwipePresentation,
  hasQueueSwipeMoved,
  measureQueueSwipe,
  QUEUE_SWIPE_MAX_OFFSET,
  requestQueueAdd,
  shouldCommitQueueSwipe,
} from "./queueSwipe";

const LOAD_MORE_CONTENT_TYPES = new Set([
  "playlist",
  "show",
  "mix",
  "liked-songs",
  "album",
]);

const FORMATTED_DATE_OPTIONS = {
  year: "numeric",
  month: "long",
  day: "numeric",
};

const formattedDates = new Map();

const ROW_TRANSITION_STYLE = { transition: "transform 0.2s ease-out" };
const TRACK_INDEX_STYLE = {
  minWidth: "3rem",
  fontSize: "32px",
  fontWeight: "580",
};

const IDLE_QUEUE_SWIPE_STATE = {
  rowKey: null,
  offset: 0,
  status: "idle",
};

const QUEUE_SUCCESS_FEEDBACK_DURATION_MS = 1000;
const QUEUE_ERROR_FEEDBACK_DURATION_MS = 1400;
const QUEUE_CLICK_SUPPRESSION_MS = 500;

const getFormattedReleaseDate = (releaseDate) => {
  if (!releaseDate) {
    return "No release date available";
  }

  if (!formattedDates.has(releaseDate)) {
    formattedDates.set(
      releaseDate,
      new Date(releaseDate).toLocaleDateString("en-US", FORMATTED_DATE_OPTIONS),
    );
  }

  return formattedDates.get(releaseDate);
};

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
  spotifyUserId,
}: UiComponentProps) => {
  const [content, setContent] = useState(null);
  const [tracks, setTracks] = useState<UiContentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedTrackIndex, setSelectedTrackIndex] = useState(-1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextUrl, setNextUrl] = useState(null);
  const [hasMoreTracks, setHasMoreTracks] = useState(false);
  const [queueSwipeState, setQueueSwipeState] = useState(
    IDLE_QUEUE_SWIPE_STATE,
  );
  const tracksContainerRef = useRef(null);
  const queueGestureRef = useRef(null);
  const queueRequestAbortRef = useRef(null);
  const queueFeedbackTimerRef = useRef(null);
  const queueMoveFrameRef = useRef(null);
  const suppressedTrackClickRef = useRef({ rowKey: null, until: 0 });
  const navigate = useNavigate();

  const { playTrack, error: playbackError } =
    useSpotifyPlayerControls(currentPlayback);

  const {
    getPlaylist,
    getPlaylistTracks,
    getAlbum,
    getAlbumTracks,
    getArtist,
    getArtistTopTracks,
    getUserTracks,
    playTrackAtPosition,
    getPlayerState,
    toggleShuffle,
    setRepeatMode,
    isSpotifyReady,
    sendSpotifyCommand,
    getShow,
    getShowEpisodes,
  } = useSpotifyWebSocket();

  const [isLazyLoading, setIsLazyLoading] = useState(false);
  const autoLoadTimerRef = useRef(null);
  const loadMoreSentinelRef = useRef(null);
  const loadMoreInFlightRef = useRef(false);
  const scrollTrackingRef = useRef({ scrollTop: 0, frameId: null });

  const tracksLengthRef = useRef(0);
  const isFetchingRef = useRef(false);
  const supportsLoadMore = LOAD_MORE_CONTENT_TYPES.has(contentType);

  const imageStyle = useMemo(() => {
    return contentType === "artist"
      ? "w-[280px] h-[280px] rounded-full drop-shadow-xl object-cover"
      : "w-[280px] h-[280px] object-cover rounded-[12px] drop-shadow-xl";
  }, [contentType]);

  const imageAlt = useMemo(() => {
    return `${content?.name || "Unknown"} Cover`;
  }, [content?.name]);

  const containerStyle = useMemo(() => ({ minWidth: "280px" }), []);

  const scrollContainerStyle = useMemo(
    () => ({
      height: "calc(100vh - 5rem)",
      paddingTop: "6px",
    }),
    [],
  );

  const titleStyle = useMemo(
    () => ({
      fontSize: "36px",
      fontWeight: "580",
      maxWidth: "280px",
    }),
    [],
  );

  const subtitleStyle = useMemo(
    () => ({
      fontSize: "28px",
      fontWeight: "560",
      maxWidth: "280px",
    }),
    [],
  );

  const handleColorsExtracted = useCallback(
    (colors) => {
      if (colors && updateGradientColors) {
        updateGradientColors(colors, contentType);
      }
    },
    [updateGradientColors, contentType],
  );

  const handleBack = useCallback(() => {
    if (onClose) {
      onClose();
    } else {
      navigate(-1);
    }
  }, [onClose, navigate]);

  const handleTrackSelect = useCallback(
    (index) => {
      if (index >= 0 && index < tracks.length) {
        const track = tracks[index];
        if (track) {
          handleTrackPlay(track, index);
        }
      }
    },
    [tracks],
  );

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

  useNavigation({
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

  useEffect(() => {
    tracksLengthRef.current = tracks.length;
  }, [tracks.length]);

  const clearQueueFeedbackTimer = useCallback(() => {
    if (queueFeedbackTimerRef.current) {
      clearTimeout(queueFeedbackTimerRef.current);
      queueFeedbackTimerRef.current = null;
    }
  }, []);

  const clearQueueMoveFrame = useCallback(() => {
    if (queueMoveFrameRef.current !== null) {
      cancelAnimationFrame(queueMoveFrameRef.current);
      queueMoveFrameRef.current = null;
    }
  }, []);

  const resetQueueSwipe = useCallback(() => {
    clearQueueMoveFrame();
    queueGestureRef.current = null;
    setQueueSwipeState(IDLE_QUEUE_SWIPE_STATE);
  }, [clearQueueMoveFrame]);

  useEffect(() => {
    clearQueueFeedbackTimer();
    queueRequestAbortRef.current?.abort();
    queueRequestAbortRef.current = null;
    resetQueueSwipe();
  }, [contentId, contentType, clearQueueFeedbackTimer, resetQueueSwipe]);

  useEffect(
    () => () => {
      clearQueueFeedbackTimer();
      clearQueueMoveFrame();
      queueRequestAbortRef.current?.abort();
      queueRequestAbortRef.current = null;
    },
    [clearQueueFeedbackTimer, clearQueueMoveFrame],
  );

  const showQueueFeedback = useCallback(
    (rowKey, status) => {
      clearQueueFeedbackTimer();
      setQueueSwipeState({
        rowKey,
        offset: -QUEUE_SWIPE_MAX_OFFSET,
        status,
      });
      queueFeedbackTimerRef.current = setTimeout(
        () => {
          setQueueSwipeState((current) =>
            current.rowKey === rowKey ? IDLE_QUEUE_SWIPE_STATE : current,
          );
          queueFeedbackTimerRef.current = null;
        },
        status === "error"
          ? QUEUE_ERROR_FEEDBACK_DURATION_MS
          : QUEUE_SUCCESS_FEEDBACK_DURATION_MS,
      );
    },
    [clearQueueFeedbackTimer],
  );

  const addTrackToQueue = useCallback(
    async (track, rowKey) => {
      if (!track?.uri || queueRequestAbortRef.current) return;

      const abortController = new AbortController();
      queueRequestAbortRef.current = abortController;
      setQueueSwipeState({
        rowKey,
        offset: -QUEUE_SWIPE_MAX_OFFSET,
        status: "pending",
      });

      try {
        await requestQueueAdd(
          sendSpotifyCommand,
          track.uri,
          abortController.signal,
        );
        if (!abortController.signal.aborted) {
          showQueueFeedback(rowKey, "success");
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.error("Failed to add track to queue:", error);
          showQueueFeedback(rowKey, "error");
        }
      } finally {
        if (queueRequestAbortRef.current === abortController) {
          queueRequestAbortRef.current = null;
        }
      }
    },
    [sendSpotifyCommand, showQueueFeedback],
  );

  const handleQueuePointerDown = useCallback(
    (event, rowKey, track) => {
      if (
        !track?.uri ||
        queueRequestAbortRef.current ||
        queueGestureRef.current ||
        queueFeedbackTimerRef.current ||
        !event.isPrimary ||
        (event.pointerType === "mouse" && event.button !== 0)
      )
        return;

      clearQueueFeedbackTimer();
      event.currentTarget.setPointerCapture(event.pointerId);
      queueGestureRef.current = {
        rowKey,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        axis: null,
        moved: false,
        rawOffset: 0,
        offset: 0,
      };
      setQueueSwipeState({ rowKey, offset: 0, status: "dragging" });
    },
    [clearQueueFeedbackTimer],
  );

  const handleQueuePointerMove = useCallback((event, rowKey) => {
    const gesture = queueGestureRef.current;
    if (
      !gesture ||
      gesture.rowKey !== rowKey ||
      gesture.pointerId !== event.pointerId
    )
      return;

    const measurement = measureQueueSwipe({
      startX: gesture.startX,
      startY: gesture.startY,
      currentX: event.clientX,
      currentY: event.clientY,
      lockedAxis: gesture.axis,
    });

    gesture.axis = measurement.axis;
    gesture.moved =
      gesture.moved ||
      hasQueueSwipeMoved({
        startX: gesture.startX,
        startY: gesture.startY,
        currentX: event.clientX,
        currentY: event.clientY,
      });
    gesture.rawOffset = measurement.rawOffset;
    gesture.offset = measurement.offset;

    if (measurement.axis === "horizontal") {
      if (event.cancelable) event.preventDefault();
      suppressedTrackClickRef.current = {
        rowKey,
        until: Date.now() + QUEUE_CLICK_SUPPRESSION_MS,
      };
      if (queueMoveFrameRef.current === null) {
        queueMoveFrameRef.current = requestAnimationFrame(() => {
          queueMoveFrameRef.current = null;
          const activeGesture = queueGestureRef.current;
          if (!activeGesture || activeGesture.axis !== "horizontal") return;
          setQueueSwipeState({
            rowKey: activeGesture.rowKey,
            offset: activeGesture.offset,
            status: "dragging",
          });
        });
      }
    }
  }, []);

  const handleQueuePointerUp = useCallback(
    (event, rowKey, track) => {
      const gesture = queueGestureRef.current;
      if (
        !gesture ||
        gesture.rowKey !== rowKey ||
        gesture.pointerId !== event.pointerId
      )
        return;

      clearQueueMoveFrame();
      const finalMeasurement = measureQueueSwipe({
        startX: gesture.startX,
        startY: gesture.startY,
        currentX: event.clientX,
        currentY: event.clientY,
        lockedAxis: gesture.axis,
      });
      const moved =
        gesture.moved ||
        hasQueueSwipeMoved({
          startX: gesture.startX,
          startY: gesture.startY,
          currentX: event.clientX,
          currentY: event.clientY,
        });
      queueGestureRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (moved) {
        suppressedTrackClickRef.current = {
          rowKey,
          until: Date.now() + QUEUE_CLICK_SUPPRESSION_MS,
        };
      }
      if (
        finalMeasurement.axis === "horizontal" &&
        shouldCommitQueueSwipe(finalMeasurement.rawOffset)
      ) {
        void addTrackToQueue(track, rowKey);
      } else {
        setQueueSwipeState(IDLE_QUEUE_SWIPE_STATE);
      }
    },
    [addTrackToQueue, clearQueueMoveFrame],
  );

  const handleQueuePointerCancel = useCallback(
    (event, rowKey) => {
      if (
        queueGestureRef.current?.rowKey !== rowKey ||
        queueGestureRef.current.pointerId !== event.pointerId
      )
        return;
      resetQueueSwipe();
    },
    [resetQueueSwipe],
  );

  const handleTrackRowClick = (track, index, rowKey) => {
    const suppressedClick = suppressedTrackClickRef.current;
    if (
      suppressedClick.rowKey === rowKey &&
      Date.now() <= suppressedClick.until
    ) {
      suppressedTrackClickRef.current = { rowKey: null, until: 0 };
      return;
    }

    if (track.uri) {
      handleTrackPlay(track, index);
    }
  };

  const loadMoreTracks = useCallback(async () => {
    if (
      !nextUrl ||
      isLoadingMore ||
      loadMoreInFlightRef.current ||
      !LOAD_MORE_CONTENT_TYPES.has(contentType)
    )
      return;

    try {
      loadMoreInFlightRef.current = true;
      setIsLoadingMore(true);

      if (contentType === "liked-songs") {
        try {
          const offset = tracksLengthRef.current;
          const data = await getUserTracks({
            offset,
            limit: 20,
          });

          const rawItems = data.items || [];
          const newTracks = rawItems.map((item) => item.track).filter(Boolean);

          if (rawItems.length === 0) {
            setNextUrl(null);
            setHasMoreTracks(false);
            return;
          }

          const newOffset = (data.offset || offset) + rawItems.length;
          const totalTracks = data.total || 0;
          const hasMore = totalTracks > 0 && newOffset < totalTracks;

          setTracks((prevTracks) => [...prevTracks, ...newTracks]);
          setNextUrl(hasMore ? "has-more" : null);
          setHasMoreTracks(hasMore);
        } catch (error) {
          console.error("WebSocket load more liked songs failed:", error);
          throw error;
        }
      } else if (contentType === "playlist" || contentType === "mix") {
        try {
          const offset = tracksLengthRef.current;
          let playlistId = contentId;

          if (contentType === "mix") {
            const foundMix = radioMixes.find((m) => m.id === contentId);
            if (foundMix && foundMix.uri) {
              playlistId = foundMix.uri.split(":").pop();
            }
          }

          const data = await getPlaylistTracks(playlistId, {
            offset,
            limit: 20,
            fields: "offset,items(track(name,id,uri,artists(name,id)))",
          });

          const rawItems = Array.isArray(data.items) ? data.items : [];

          if (rawItems.length === 0) {
            setNextUrl(null);
            setHasMoreTracks(false);
            return;
          }

          const newTracks = rawItems.map((item) => item.track);
          const newOffset = (data.offset || offset) + rawItems.length;
          const totalTracks = content?.tracks?.total || 0;
          const hasMore =
            data.next || (totalTracks > 0 && newOffset < totalTracks);

          setTracks((prevTracks) => [...prevTracks, ...newTracks]);
          setNextUrl(hasMore ? data.next || "has-more" : null);
          setHasMoreTracks(hasMore);
        } catch (error) {
          console.error("WebSocket load more tracks failed:", error);
          throw error;
        }
      } else if (contentType === "show") {
        try {
          const offset = tracksLengthRef.current;

          if (offset >= 50) {
            setHasMoreTracks(false);
            setNextUrl(null);
            return;
          }

          const data = await getShowEpisodes(contentId, {
            offset,
            limit: 5,
          });

          const newEpisodes = data.items || [];
          const totalEpisodes = data.total || 0;

          if (newEpisodes.length === 0) {
            setNextUrl(null);
            setHasMoreTracks(false);
            return;
          }

          setTracks((prevTracks) => {
            const updatedTracks = [...prevTracks, ...newEpisodes];
            const limitedTracks = updatedTracks.slice(0, 50);
            tracksLengthRef.current = limitedTracks.length;
            return limitedTracks;
          });

          const newOffset = offset + newEpisodes.length;
          const hasMore = newOffset < totalEpisodes && newOffset < 50;
          setNextUrl(hasMore ? "has-more" : null);
          setHasMoreTracks(hasMore);
        } catch (error) {
          console.error("WebSocket load more episodes failed:", error);
          throw error;
        }
      } else if (contentType === "album") {
        try {
          const offset = tracksLengthRef.current;
          const data = await getAlbumTracks(contentId, {
            offset,
            limit: 50,
          });

          const rawItems = Array.isArray(data.items) ? data.items : [];

          if (rawItems.length === 0) {
            setNextUrl(null);
            setHasMoreTracks(false);
            return;
          }

          const newOffset = (data.offset || offset) + rawItems.length;
          const totalTracks = content?.total_tracks || 0;
          const hasMore =
            data.next || (totalTracks > 0 && newOffset < totalTracks);

          setTracks((prevTracks) => [...prevTracks, ...rawItems]);
          setNextUrl(hasMore ? data.next || "has-more" : null);
          setHasMoreTracks(hasMore);
        } catch (error) {
          console.error("WebSocket load more album tracks failed:", error);
          throw error;
        }
      } else {
        console.error(
          "Load more tracks not implemented for content type:",
          contentType,
        );
        return;
      }
    } catch (err) {
      console.error("Error loading more tracks:", err);
      setNextUrl(null);
      setHasMoreTracks(false);
    } finally {
      loadMoreInFlightRef.current = false;
      setIsLoadingMore(false);
    }
  }, [
    nextUrl,
    isLoadingMore,
    contentType,
    contentId,
    content,
    getPlaylistTracks,
    getShowEpisodes,
    getUserTracks,
    getAlbumTracks,
    radioMixes,
  ]);

  useEffect(() => {
    const clearAutoLoadTimer = () => {
      if (autoLoadTimerRef.current) {
        clearTimeout(autoLoadTimerRef.current);
        autoLoadTimerRef.current = null;
      }
    };

    clearAutoLoadTimer();
    setIsLazyLoading(false);

    return clearAutoLoadTimer;
  }, [contentId, contentType]);

  useEffect(() => {
    const container = tracksContainerRef.current;
    if (!container) {
      return;
    }

    const handleScroll = () => {
      if (scrollTrackingRef.current.frameId !== null) {
        return;
      }

      scrollTrackingRef.current.frameId = requestAnimationFrame(() => {
        scrollTrackingRef.current.frameId = null;
        scrollTrackingRef.current.scrollTop = container.scrollTop;
      });
    };

    container.addEventListener("scroll", handleScroll);
    return () => {
      container.removeEventListener("scroll", handleScroll);

      if (scrollTrackingRef.current.frameId !== null) {
        cancelAnimationFrame(scrollTrackingRef.current.frameId);
        scrollTrackingRef.current.frameId = null;
      }
    };
  }, []);

  useEffect(() => {
    if (
      !supportsLoadMore ||
      !hasMoreTracks ||
      isLoadingMore ||
      isLazyLoading ||
      tracks.length === 0
    ) {
      return;
    }

    if (autoLoadTimerRef.current) {
      clearTimeout(autoLoadTimerRef.current);
    }

    autoLoadTimerRef.current = setTimeout(async () => {
      autoLoadTimerRef.current = null;
      setIsLazyLoading(true);

      try {
        if (!loadMoreInFlightRef.current) {
          await loadMoreTracks();
        }
      } finally {
        setIsLazyLoading(false);
      }
    }, 100);

    return () => {
      if (autoLoadTimerRef.current) {
        clearTimeout(autoLoadTimerRef.current);
        autoLoadTimerRef.current = null;
      }
    };
  }, [
    hasMoreTracks,
    isLoadingMore,
    isLazyLoading,
    tracks.length,
    supportsLoadMore,
    loadMoreTracks,
  ]);

  useEffect(() => {
    const container = tracksContainerRef.current;
    const sentinel = loadMoreSentinelRef.current;

    if (
      !container ||
      !sentinel ||
      !supportsLoadMore ||
      !hasMoreTracks ||
      isLoadingMore ||
      isLazyLoading
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (
          entry?.isIntersecting &&
          hasMoreTracks &&
          !isLoadingMore &&
          !isLazyLoading
        ) {
          loadMoreTracks();
        }
      },
      {
        root: container,
        threshold: 0,
      },
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [
    hasMoreTracks,
    isLoadingMore,
    isLazyLoading,
    loadMoreTracks,
    supportsLoadMore,
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
    if (contentType === "mix") return;

    const fetchWebSocketContent = async () => {
      if (!contentId && contentType !== "liked-songs") return;

      if (!isSpotifyReady) {
        console.log("Spotify not ready, skipping fetch");
        return;
      }

      if (isFetchingRef.current) {
        console.log("Already fetching, skipping duplicate request");
        return;
      }

      try {
        isFetchingRef.current = true;
        setIsLoading(true);
        setIsLazyLoading(false);
        setNextUrl(null);
        setHasMoreTracks(false);
        setIsLoadingMore(false);
        loadMoreInFlightRef.current = false;
        if (autoLoadTimerRef.current) {
          clearTimeout(autoLoadTimerRef.current);
          autoLoadTimerRef.current = null;
        }

        let contentData;
        let tracksData = [];

        switch (contentType) {
          case "album": {
            try {
              const [albumInfo, tracksResponse] = await Promise.all([
                getAlbum(contentId),
                getAlbumTracks(contentId),
              ]);

              contentData = albumInfo;
              tracksData = tracksResponse.items || [];

              const currentOffset = tracksResponse.offset || 0;
              const currentItems = tracksResponse.items?.length || 0;
              const totalTracks = albumInfo.total_tracks || 0;
              const hasMore = currentOffset + currentItems < totalTracks;

              setNextUrl(hasMore ? tracksResponse.next || "has-more" : null);
              setHasMoreTracks(hasMore);
            } catch (error) {
              console.error("WebSocket album fetch failed:", error);
              throw new Error(
                `Failed to fetch album via WebSocket: ${error.message}`,
              );
            }
            break;
          }

          case "playlist": {
            try {
              const [playlistInfo, tracksResponse] = await Promise.all([
                getPlaylist(contentId, "images,name,tracks.total"),
                getPlaylistTracks(contentId, {
                  offset: 0,
                  limit: 20,
                  fields: "offset,items(track(name,id,uri,artists(name,id)))",
                }),
              ]);

              contentData = playlistInfo;
              tracksData = Array.isArray(tracksResponse.items)
                ? tracksResponse.items.map((item) => item.track).filter(Boolean)
                : [];

              const currentOffset = tracksResponse.offset || 0;
              const currentItems = tracksResponse.items?.length || 0;
              const totalTracks = playlistInfo.tracks?.total || 0;
              const hasMore = currentOffset + currentItems < totalTracks;

              setNextUrl(hasMore ? tracksResponse.next || "has-more" : null);
              setHasMoreTracks(hasMore);
            } catch (error) {
              console.error("WebSocket playlist fetch failed:", error);
              throw new Error(
                `Failed to fetch playlist via WebSocket: ${error.message}`,
              );
            }
            break;
          }

          case "artist": {
            try {
              const [artistInfo, tracksResponse] = await Promise.all([
                getArtist(contentId),
                getArtistTopTracks(contentId),
              ]);

              contentData = artistInfo;
              tracksData = Array.isArray(tracksResponse.tracks)
                ? tracksResponse.tracks
                : Array.isArray(tracksResponse)
                  ? tracksResponse
                  : [];

              setHasMoreTracks(false);
            } catch (error) {
              console.error("WebSocket artist fetch failed:", error);
              throw new Error(
                `Failed to fetch artist via WebSocket: ${error.message}`,
              );
            }
            break;
          }

          case "liked-songs": {
            try {
              const tracksResponse = await getUserTracks({
                limit: 20,
                offset: 0,
              });

              contentData = {
                name: "Liked Songs",
                images: [{ url: "/images/liked-songs.webp" }],
                tracks: { total: tracksResponse.total || 0 },
              };
              tracksData = Array.isArray(tracksResponse.items)
                ? tracksResponse.items.map((item) => item.track).filter(Boolean)
                : Array.isArray(tracksResponse.tracks)
                  ? tracksResponse.tracks
                  : [];

              const currentOffset = tracksResponse.offset || 0;
              const currentItems = tracksResponse.items?.length || 0;
              const totalTracks = tracksResponse.total || 0;
              const hasMore = currentOffset + currentItems < totalTracks;

              setHasMoreTracks(hasMore);
              setNextUrl(hasMore ? "has-more" : null);
            } catch (error) {
              console.error("WebSocket liked songs fetch failed:", error);
              throw new Error(
                `Failed to fetch liked songs via WebSocket: ${error.message}`,
              );
            }
            break;
          }

          case "show": {
            try {
              const [showInfo, episodesResponse] = await Promise.all([
                getShow(contentId),
                getShowEpisodes(contentId, { limit: 5 }),
              ]);

              contentData = showInfo;
              tracksData = Array.isArray(episodesResponse.items)
                ? episodesResponse.items
                : [];

              const currentOffset = episodesResponse.offset || 0;
              const currentItems = episodesResponse.items?.length || 0;
              const totalEpisodes =
                episodesResponse.total || showInfo.total_episodes || 0;
              const hasMore =
                currentOffset + currentItems < totalEpisodes &&
                currentItems < 50;

              setNextUrl(hasMore ? "has-more" : null);
              setHasMoreTracks(hasMore);
              tracksLengthRef.current = tracksData.length;
            } catch (error) {
              console.error("WebSocket show fetch failed:", error);
              throw new Error(
                `Failed to fetch show via WebSocket: ${error.message}`,
              );
            }
            break;
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
      if (autoLoadTimerRef.current) {
        clearTimeout(autoLoadTimerRef.current);
        autoLoadTimerRef.current = null;
      }
    };
  }, [contentId, contentType, isSpotifyReady]);

  useEffect(() => {
    if (contentType !== "mix") return;

    const fetchMixContent = async () => {
      if (!contentId || !isSpotifyReady) return;

      try {
        setIsLoading(true);
        setIsLazyLoading(false);
        setNextUrl(null);
        setHasMoreTracks(false);
        setIsLoadingMore(false);
        loadMoreInFlightRef.current = false;
        if (autoLoadTimerRef.current) {
          clearTimeout(autoLoadTimerRef.current);
          autoLoadTimerRef.current = null;
        }

        const foundMix = radioMixes.find((m) => m.id === contentId);

        if (foundMix) {
          const contentData = {
            ...foundMix,
            type: foundMix.type || "mix",
            images: foundMix.images || [],
          };

          if (
            contentData?.images &&
            contentData.images.length > 0 &&
            updateGradientColors
          ) {
            const imageUrl =
              contentData.images[1]?.url || contentData.images[0].url;

            if (foundMix.type === "static" && imageUrl.startsWith("/images/")) {
              extractColorsFromImage(imageUrl).then((colors) => {
                if (colors && updateGradientColors) {
                  updateGradientColors(colors, contentType);
                }
              });
            } else {
              updateGradientColors(imageUrl, contentType);
            }
          }

          if (foundMix.uri && foundMix.uri.includes("playlist:")) {
            try {
              const playlistId = foundMix.uri.split(":").pop();
              const [playlistInfo, tracksResponse] = await Promise.all([
                getPlaylist(playlistId, "images,name,tracks.total"),
                getPlaylistTracks(playlistId, {
                  offset: 0,
                  limit: 20,
                  fields: "offset,items(track(name,id,uri,artists(name,id)))",
                }),
              ]);

              const tracksData = Array.isArray(tracksResponse.items)
                ? tracksResponse.items.map((item) => item.track).filter(Boolean)
                : [];
              const currentOffset = tracksResponse.offset || 0;
              const currentItems = tracksResponse.items?.length || 0;
              const totalTracks = playlistInfo.tracks?.total || 0;
              const hasMore = currentOffset + currentItems < totalTracks;

              setContent({
                ...contentData,
                images: playlistInfo.images || contentData.images,
                tracks: { total: totalTracks },
              });
              setTracks(tracksData);
              setNextUrl(hasMore ? tracksResponse.next || "has-more" : null);
              setHasMoreTracks(hasMore);
            } catch (error) {
              console.error("Failed to fetch mix tracks:", error);
              setContent(contentData);
              setTracks([]);
            }
          } else {
            if (foundMix.type === "static") {
              try {
                let result;
                if (foundMix.id === "top-mix") {
                  result = await sendSpotifyCommand("spotify.radio.topMix");
                } else if (foundMix.id === "discoveries-mix") {
                  result = await sendSpotifyCommand(
                    "spotify.radio.discoveries",
                  );
                }

                if (result && result.tracks) {
                  const tracksData = Array.isArray(result.tracks)
                    ? result.tracks
                    : [];
                  setContent({
                    ...contentData,
                    tracks: { total: tracksData.length },
                  });
                  setTracks(tracksData);
                  setHasMoreTracks(false);
                } else {
                  setContent(contentData);
                  setTracks([]);
                }
              } catch (error) {
                console.error(
                  `Failed to fetch ${foundMix.name} tracks:`,
                  error,
                );
                setContent(contentData);
                setTracks([]);
              }
            } else {
              const tracksData = Array.isArray(foundMix.tracks)
                ? foundMix.tracks
                : [];
              setContent(contentData);
              setTracks(tracksData);
            }
          }
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
  }, [
    contentId,
    contentType,
    radioMixes,
    updateGradientColors,
    isSpotifyReady,
    getPlaylist,
    getPlaylistTracks,
    sendSpotifyCommand,
  ]);

  const handleTrackPlay = async (track, index) => {
    if (!track || !track.uri) {
      console.warn("Attempted to play an invalid track:", track);
      return;
    }

    if (track.uri === currentlyPlayingTrackUri && currentPlayback?.is_playing) {
      if (onNavigateToNowPlaying) {
        onNavigateToNowPlaying();
      }
      return;
    }

    let contextUri = null;
    let uris = null;
    let success = false;
    let originalPlayerState = null;

    try {
      originalPlayerState = await getPlayerState();
    } catch (error) {
      console.warn(
        "Could not get player state, proceeding without preserving settings:",
        error,
      );
    }

    if (originalPlayerState?.shuffle_state) {
      try {
        await toggleShuffle(false);
      } catch (error) {
        console.warn("Could not disable shuffle before playing:", error);
      }
    }

    try {
      if (contentType === "playlist") {
        contextUri = `spotify:playlist:${contentId}`;
        success = await playTrackAtPosition(contextUri, index);
      } else if (contentType === "album") {
        contextUri = `spotify:album:${contentId}`;
        success = await playTrack(track.uri, contextUri);
      } else if (contentType === "artist") {
        contextUri = `spotify:artist:${contentId}`;
        success = await playTrack(track.uri, contextUri);
      } else if (contentType === "show") {
        contextUri = `spotify:show:${contentId}`;
        success = await playTrack(track.uri, contextUri);
      } else if (contentType === "mix") {
        const currentMix = radioMixes.find((m) => m.id === contentId);
        if (currentMix && currentMix.uri) {
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
        if (spotifyUserId) {
          const likedSongsContextUri = `spotify:user:${spotifyUserId}:collection`;
          success = await playTrack(track.uri, likedSongsContextUri, null);
        } else {
          uris = tracks.filter((t) => t && t.uri).map((t) => t.uri);
          const startIndex = index || 0;
          uris = uris.slice(startIndex).concat(uris.slice(0, startIndex));
          success = await playTrack(track.uri, null, uris);
        }
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
        return `${formatNumber(content.tracks?.total || content.trackCount || content.tracks?.length || 0)} Tracks`;
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
          {contentType === "liked-songs" ||
          (contentType === "mix" && content.type === "static") ? (
            <img
              src={getImageUrl()}
              alt={imageAlt}
              width={280}
              height={280}
              className={imageStyle}
              onLoad={(e) => {
                if (contentType === "mix" && content.type === "static") {
                  extractColorsFromImage(e.target.src).then((colors) => {
                    if (colors && updateGradientColors) {
                      updateGradientColors(colors, contentType);
                    }
                  });
                }
              }}
            />
          ) : (
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
          )}
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
        {(Array.isArray(tracks) ? tracks : []).map((track, index) => {
          if (!track) return null;

          const rowKey = `${track.uri || track.id || "track"}-${index}`;
          const isActiveQueueSwipe = queueSwipeState.rowKey === rowKey;
          const queueSwipeOffset = isActiveQueueSwipe
            ? queueSwipeState.offset
            : 0;
          const queueStatus = isActiveQueueSwipe
            ? queueSwipeState.status
            : "idle";
          const queuePresentation = getQueueSwipePresentation(queueSwipeOffset);
          const isQueueArmed =
            queueStatus === "dragging" &&
            shouldCommitQueueSwipe(queueSwipeOffset);
          const queueStatusLabel =
            queueStatus === "success"
              ? `${track.name || "Track"} added to queue`
              : queueStatus === "error"
                ? `Could not add ${track.name || "track"} to queue`
                : `Add ${track.name || "track"} to queue`;

          return (
            <div
              key={`${track.id || "track"}-${index}`}
              className={`relative mb-5 overflow-hidden rounded-xl transition-transform duration-200 ease-out ${
                selectedTrackIndex === index ? "scale-105" : ""
              }`}
              style={ROW_TRANSITION_STYLE}
              data-track-index={index}
            >
              <div
                className={`queue-swipe-action pointer-events-none absolute inset-y-0 right-0 z-20 flex items-center justify-center overflow-hidden rounded-r-xl ${
                  isActiveQueueSwipe ? "queue-swipe-action-active" : ""
                } ${
                  queueStatus === "dragging"
                    ? "queue-swipe-action-dragging"
                    : ""
                } ${isQueueArmed ? "queue-swipe-action-armed" : ""} ${
                  queueStatus === "pending" ? "queue-swipe-action-pending" : ""
                } ${
                  queueStatus === "success" ? "queue-swipe-action-success" : ""
                } ${queueStatus === "error" ? "queue-swipe-action-error" : ""}`}
                style={{
                  width: `${QUEUE_SWIPE_MAX_OFFSET}px`,
                  opacity: queuePresentation.panelOpacity,
                  transform: `translate3d(${QUEUE_SWIPE_MAX_OFFSET - queuePresentation.reveal}px, 0, 0)`,
                }}
                role={
                  queueStatus === "error"
                    ? "alert"
                    : queueStatus === "success"
                      ? "status"
                      : undefined
                }
                aria-label={
                  queueStatus === "success" || queueStatus === "error"
                    ? queueStatusLabel
                    : undefined
                }
                aria-hidden={
                  queueStatus === "success" || queueStatus === "error"
                    ? undefined
                    : true
                }
              >
                <div
                  className="queue-swipe-icon-stage"
                  style={{
                    transform: `translate3d(${queuePresentation.iconTranslateX}px, 0, 0) scale(${queuePresentation.iconScale}) rotate(${queuePresentation.iconRotation}deg)`,
                  }}
                >
                  <div
                    className={`queue-swipe-icon-bump ${
                      isQueueArmed ? "queue-swipe-icon-bump-armed" : ""
                    }`}
                  >
                    <PlaylistAddIcon
                      className={`queue-swipe-icon-layer h-9 w-9 text-white ${
                        queueStatus === "dragging"
                          ? "queue-swipe-icon-layer-visible"
                          : "queue-swipe-icon-layer-hidden"
                      }`}
                    />
                    <span
                      className={`queue-swipe-icon-layer h-9 w-9 ${
                        queueStatus === "pending"
                          ? "queue-swipe-icon-layer-visible"
                          : "queue-swipe-icon-layer-hidden"
                      }`}
                    >
                      <span className="queue-swipe-spinner" />
                    </span>
                    <CheckCircleIcon
                      className={`queue-swipe-icon-confirm queue-swipe-icon-layer h-9 w-9 text-white ${
                        queueStatus === "success"
                          ? "queue-swipe-icon-layer-visible"
                          : "queue-swipe-icon-layer-hidden"
                      }`}
                    />
                    <AlertCircleIcon
                      className={`queue-swipe-icon-error queue-swipe-icon-layer h-9 w-9 text-white ${
                        queueStatus === "error"
                          ? "queue-swipe-icon-layer-visible"
                          : "queue-swipe-icon-layer-hidden"
                      }`}
                    />
                  </div>
                </div>
              </div>

              <div
                className={`queue-swipe-content relative z-10 flex select-none items-start ${
                  isActiveQueueSwipe ? "queue-swipe-content-active" : ""
                } ${
                  queueStatus === "dragging"
                    ? "queue-swipe-content-dragging"
                    : ""
                } ${
                  queueStatus === "pending"
                    ? "queue-swipe-content-committing"
                    : ""
                }`}
                style={{
                  transform: `translate3d(${queueSwipeOffset}px, 0, 0)`,
                  touchAction: "pan-y",
                }}
                onClick={() => handleTrackRowClick(track, index, rowKey)}
                onPointerDown={(event) =>
                  handleQueuePointerDown(event, rowKey, track)
                }
                onPointerMove={(event) => handleQueuePointerMove(event, rowKey)}
                onPointerUp={(event) =>
                  handleQueuePointerUp(event, rowKey, track)
                }
                onPointerCancel={(event) =>
                  handleQueuePointerCancel(event, rowKey)
                }
                onLostPointerCapture={(event) =>
                  handleQueuePointerCancel(event, rowKey)
                }
              >
                <div
                  className="text-3xl font-semibold text-center text-white/60 mr-6 mt-3 flex justify-center"
                  style={TRACK_INDEX_STYLE}
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
                        {getFormattedReleaseDate(track.release_date)}
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
            </div>
          );
        })}

        {supportsLoadMore && (
          <div ref={loadMoreSentinelRef} style={{ height: 1 }} />
        )}

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

        {isLazyLoading &&
          (contentType === "playlist" || contentType === "show") && (
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
