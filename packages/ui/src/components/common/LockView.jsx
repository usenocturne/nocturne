import { useEffect, useRef, useCallback } from "react";
import { useCurrentTime } from "../../hooks/useCurrentTime";
import { useAuth } from "../../hooks/useAuth";
import { useSpotifyPlayerControls } from "../../hooks/useSpotifyPlayerControls";
import { useGestureControls } from "../../hooks/useGestureControls";

export default function LockView({ onClose, currentPlayback, refreshPlaybackState }) {
  const { currentTime } = useCurrentTime();
  const containerRef = useRef(null);
  const { accessToken } = useAuth();
  const {
    playTrack,
    pausePlayback,
    skipToNext,
    skipToPrevious,
  } = useSpotifyPlayerControls(accessToken);

  const handlePlayPause = useCallback(async () => {
    if (!accessToken) return;

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
  }, [accessToken, currentPlayback, playTrack, pausePlayback, refreshPlaybackState]);

  useGestureControls({
    contentRef: containerRef,
    onSwipeLeft: async () => {
      const ok = await skipToNext();
      if (ok && refreshPlaybackState) {
        setTimeout(() => refreshPlaybackState(true), 500);
      }
    },
    onSwipeRight: async () => {
      const ok = await skipToPrevious();
      if (ok && refreshPlaybackState) {
        setTimeout(() => refreshPlaybackState(true), 500);
      }
    },
    isActive: true,
  });

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" || e.key === "m") {
        onClose();
      } else if (e.key === "Enter") {
        handlePlayPause();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, handlePlayPause]);

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
