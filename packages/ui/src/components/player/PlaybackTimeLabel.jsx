import { memo, useMemo } from "react";
import { useProgressValue } from "../../hooks/usePlaybackProgress";

const formatTime = (ms, elapsed) => {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const formattedMinutes = minutes.toString().padStart(2, "0");
  const formattedSeconds = seconds.toString().padStart(2, "0");

  const prefix = elapsed ? "" : "-";

  if (hours > 0) {
    return `${prefix}${hours}:${formattedMinutes}:${formattedSeconds}`;
  }

  return `${prefix}${formattedMinutes}:${formattedSeconds}`;
};

const PlaybackTimeLabel = ({
  isSpotifyPending,
  isElapsed = true,
  durationMs,
}) => {
  const { progressMs } = useProgressValue();
  const value = useMemo(() => {
    if (isSpotifyPending) return "--:--";
    if (isElapsed) return formatTime(progressMs, true);
    const remaining = Math.max(0, (durationMs || 0) - progressMs);
    return formatTime(remaining, false);
  }, [progressMs, isElapsed, durationMs, isSpotifyPending]);
  return <>{value}</>;
};

export default memo(PlaybackTimeLabel);
