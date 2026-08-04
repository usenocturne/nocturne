import { useEffect, useRef, useCallback } from "react";
import type { SpotifyPlayback, UpdateGradientColors } from "../../types";
import { useCurrentTime } from "../../hooks/useCurrentTime";
import { useSpotifyPlayerControls } from "../../hooks/useSpotifyPlayerControls";
import { useGestureControls } from "../../hooks/useGestureControls";
interface LockViewProps {
  onClose: () => void;
  currentPlayback: SpotifyPlayback | null;
  refreshPlaybackState: (forceRefresh?: boolean) => void | Promise<void>;
  updateGradientColors: UpdateGradientColors;
}

export default function LockView({
  onClose,
  currentPlayback,
  refreshPlaybackState,
  updateGradientColors,
}: LockViewProps) {
  const { currentTime } = useCurrentTime();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const {
    playTrack,
    pausePlayback,
    skipToNext,
    skipToPrevious,
    phoneMediaPlay,
    phoneMediaPause,
    phoneMediaNext,
    phoneMediaPrevious,
  } = useSpotifyPlayerControls(currentPlayback);

  const isPhoneMedia = currentPlayback?.item?.is_phone_media === true;

  const handlePlayPause = useCallback(async () => {
    if (isPhoneMedia) {
      if (currentPlayback?.is_playing) {
        await phoneMediaPause();
      } else {
        await phoneMediaPlay();
      }
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
    phoneMediaPlay,
    phoneMediaPause,
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
    onSwipeUp: undefined,
    onSwipeDown: undefined,
    isActive: true,
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
      let imageUrl: string | null = null;
      // Boundary: playback item may be a daemon-enriched track or episode payload.
      const item = currentPlayback.item as unknown as UiLooseData;

      if (item.type === "episode") {
        const candidate = item.show?.images?.[0]?.url || item.images?.[0]?.url;
        imageUrl = typeof candidate === "string" ? candidate : null;
      } else if (item.type === "track") {
        const candidate = item.album?.images?.[0]?.url;
        imageUrl = typeof candidate === "string" ? candidate : null;
      }

      if (imageUrl && imageUrl !== "/images/not-playing.webp") {
        updateGradientColors(imageUrl, "lock");
      }
    }
  }, [currentPlayback?.item, updateGradientColors]);

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
