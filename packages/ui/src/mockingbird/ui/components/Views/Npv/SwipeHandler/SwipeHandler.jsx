import { runInAction } from "mobx";
import { useSwipeable } from "react-swipeable";

export const SwipeDirection = {
  NONE: "NONE",
  LEFT: "LEFT",
  RIGHT: "RIGHT",
};

export class SwipeHandlerClass {
  swipeDirection = SwipeDirection.NONE;
  playerStore;
  npvUbiLogger;

  constructor(playerStore, npvUbiLogger = null) {
    this.playerStore = playerStore;
    this.npvUbiLogger = npvUbiLogger;
  }

  setSwipeDirection(direction) {
    this.swipeDirection = direction;
  }

  handleSwipedLeft = () => {
    if (this.playerStore.currentTrack?.uri) {
      runInAction(() => {
        if (this.npvUbiLogger) {
          this.npvUbiLogger.logSwipeSkipNext(
            this.playerStore.currentTrack.uri,
            this.playerStore.currentTrackPosition || 0,
            this.playerStore.currentTrack.duration_ms || 0,
          );
        }
      });
    }
    this.setSwipeDirection(SwipeDirection.LEFT);
    if (this.playerStore.skipNext) {
      this.playerStore.skipNext();
    }
  };

  handleSwipedRight = () => {
    if (this.playerStore.currentTrack?.uri) {
      runInAction(() => {
        if (this.npvUbiLogger) {
          this.npvUbiLogger.logSwipeSkipPrevious(
            this.playerStore.currentTrack.uri,
            this.playerStore.currentTrackPosition || 0,
            this.playerStore.currentTrack.duration_ms || 0,
          );
        }
      });
    }
    this.setSwipeDirection(SwipeDirection.RIGHT);
    if (this.playerStore.skipPrev || this.playerStore.skipPrevForce) {
      (this.playerStore.skipPrevForce || this.playerStore.skipPrev)();
    }
  };
}

const SwipeHandler = ({
  children,
  onSwipeLeft,
  onSwipeRight,
  onSwipeUp,
  onSwipeDown,
  disabled,
}) => {
  const swipeHandlers = useSwipeable({
    onSwipedLeft: !disabled ? onSwipeLeft : undefined,
    onSwipedRight: !disabled ? onSwipeRight : undefined,
    onSwipedUp: !disabled ? onSwipeUp : undefined,
    onSwipedDown: !disabled ? onSwipeDown : undefined,
  });

  return <div {...swipeHandlers}>{children}</div>;
};

export default SwipeHandler;
