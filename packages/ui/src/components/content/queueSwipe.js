export const QUEUE_SWIPE_MAX_OFFSET = 88;
export const QUEUE_SWIPE_COMMIT_OFFSET = 64;
export const QUEUE_SWIPE_DIRECTION_LOCK_PX = 10;
const DIRECTION_DOMINANCE_RATIO = 1.25;
const POST_COMMIT_RESISTANCE = 0.5;

export const hasQueueSwipeMoved = ({ startX, startY, currentX, currentY }) =>
  Math.max(Math.abs(currentX - startX), Math.abs(currentY - startY)) >=
  QUEUE_SWIPE_DIRECTION_LOCK_PX;

export const getQueueSwipeVisualOffset = (rawOffset) => {
  const distance = Math.max(0, -rawOffset);
  if (distance === 0) return 0;
  if (distance <= QUEUE_SWIPE_COMMIT_OFFSET) return -distance;

  const resistedDistance =
    QUEUE_SWIPE_COMMIT_OFFSET +
    (distance - QUEUE_SWIPE_COMMIT_OFFSET) * POST_COMMIT_RESISTANCE;
  return -Math.min(QUEUE_SWIPE_MAX_OFFSET, resistedDistance);
};

export const measureQueueSwipe = ({
  startX,
  startY,
  currentX,
  currentY,
  lockedAxis = null,
}) => {
  const deltaX = currentX - startX;
  const deltaY = currentY - startY;
  let axis = lockedAxis;

  if (!axis && hasQueueSwipeMoved({ startX, startY, currentX, currentY })) {
    if (Math.abs(deltaX) > Math.abs(deltaY) * DIRECTION_DOMINANCE_RATIO) {
      axis = "horizontal";
    } else if (
      Math.abs(deltaY) >
      Math.abs(deltaX) * DIRECTION_DOMINANCE_RATIO
    ) {
      axis = "vertical";
    }
  }

  const rawOffset = axis === "horizontal" ? Math.min(0, deltaX) : 0;
  const offset = getQueueSwipeVisualOffset(rawOffset);

  return { axis, rawOffset, offset };
};

export const shouldCommitQueueSwipe = (offset) =>
  offset <= -QUEUE_SWIPE_COMMIT_OFFSET;

export const getQueueSwipePresentation = (offset) => {
  const reveal = Math.min(QUEUE_SWIPE_MAX_OFFSET, Math.max(0, -offset));
  const progress = reveal / QUEUE_SWIPE_MAX_OFFSET;

  return {
    reveal,
    progress,
    panelOpacity: Math.min(1, progress * 1.8),
    iconScale: 0.76 + progress * 0.24,
    iconTranslateX: (1 - progress) * 12,
    iconRotation: (1 - progress) * -6,
  };
};

export const requestQueueAdd = (sendSpotifyCommand, uri, signal) =>
  sendSpotifyCommand("spotify.player.queue.add", { uri }, signal);
