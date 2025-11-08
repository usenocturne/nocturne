import { useEffect, useRef, useCallback } from "react";
import { useCurrentTime } from "../../hooks/useCurrentTime";
import { useSpotifyPlayerControls } from "../../hooks/useSpotifyPlayerControls";
import { useGestureControls } from "../../hooks/useGestureControls";

export default function LockView({
  onClose,
  currentPlayback,
  refreshPlaybackState,
  updateGradientColors,
}) {
  const { currentTime } = useCurrentTime();
  const containerRef = useRef(null);
  const {
    playTrack,
    pausePlayback,
    skipToNext,
    skipToPrevious,
    phoneMediaPlayPause,
    phoneMediaNext,
    phoneMediaPrevious,
  } = useSpotifyPlayerControls(currentPlayback);

  const isPhoneMedia = currentPlayback?.item?.is_phone_media === true;

  const handlePlayPause = useCallback(async () => {
    if (isPhoneMedia) {
      await phoneMediaPlayPause();
      if (refreshPlaybackState) {
        setTimeout(() => refreshPlaybackState(true), 300);
      }
      return;
    }

    if (currentPlayback?.is_playing) {
      const ok = await pausePlayback();
      if (ok && refreshPlaybackState) {
        setTimeout(() => refreshPlaybackState(true), 300);
      }
      return;
    }

    if (currentPlayback?.item) {
      const ok = await playTrack();
      if (ok && refreshPlaybackState) {
        setTimeout(() => refreshPlaybackState(true), 300);
      }
      return;
    }
  }, [
    currentPlayback,
    playTrack,
    pausePlayback,
    phoneMediaPlayPause,
    isPhoneMedia,
    refreshPlaybackState,
  ]);

  useGestureControls({
    contentRef: containerRef,
    onSwipeLeft: async () => {
      if (isPhoneMedia) {
        await phoneMediaNext();
        if (refreshPlaybackState) {
          setTimeout(() => refreshPlaybackState(true), 500);
        }
      } else {
        const ok = await skipToNext();
        if (ok && refreshPlaybackState) {
          setTimeout(() => refreshPlaybackState(true), 500);
        }
      }
    },
    onSwipeRight: async () => {
      if (isPhoneMedia) {
        await phoneMediaPrevious();
        if (refreshPlaybackState) {
          setTimeout(() => refreshPlaybackState(true), 500);
        }
      } else {
        const ok = await skipToPrevious();
        if (ok && refreshPlaybackState) {
          setTimeout(() => refreshPlaybackState(true), 500);
        }
      }
    },
    isActive: true,
  });

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter") {
        handlePlayPause();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, handlePlayPause]);

  useEffect(() => {
    if (currentPlayback?.item && updateGradientColors) {
      let imageUrl = null;

      if (currentPlayback.item.type === "episode") {
        imageUrl =
          currentPlayback.item.show?.images?.[0]?.url ||
          currentPlayback.item.images?.[0]?.url;
      } else if (currentPlayback.item.type === "track") {
        imageUrl = currentPlayback.item.album?.images?.[0]?.url;
      }

      if (imageUrl && imageUrl !== "/images/not-playing.webp") {
        updateGradientColors(imageUrl, "lock");
      }
    }
  }, [
    currentPlayback?.item?.id,
    currentPlayback?.item?.type,
    currentPlayback?.item?.album?.images?.[0]?.url,
    currentPlayback?.item?.show?.images?.[0]?.url,
    currentPlayback?.item?.images?.[0]?.url,
    updateGradientColors,
  ]);

  return (
    <div
      ref={containerRef}
      className="flex items-center justify-center h-screen w-full z-10 fadeIn-animation text-white"
    >
      <div className="text-[20vw] leading-none font-semibold tracking-tight">
        {currentTime}
      </div>
    </div>
  );
}
