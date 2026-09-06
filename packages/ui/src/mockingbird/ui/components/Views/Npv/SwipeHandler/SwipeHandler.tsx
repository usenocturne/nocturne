import type { ReactNode } from "react";
import type { SwipeEventData } from "react-swipeable";
import type { PlayerItem } from "../../../../stores/PlayerStore";
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

  constructor(
    playerStore: SwipePlayer,
    npvUbiLogger: SwipeLogger | null = null,
  ) {
    this.playerStore = playerStore;
    this.npvUbiLogger = npvUbiLogger;
  }

  setSwipeDirection(direction: string) {
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
    const previous =
      this.playerStore.skipPrevForce || this.playerStore.skipPrev;
    previous?.();
  };
}

const SwipeHandler = ({
  children,
  onSwipeLeft,
  onSwipeRight,
  onSwipeUp,
  onSwipeDown,
  disabled,
}: {
  children?: ReactNode;
  disabled?: boolean;
  onSwipeLeft?: (event: SwipeEventData) => void;
  onSwipeRight?: (event: SwipeEventData) => void;
  onSwipeUp?: (event: SwipeEventData) => void;
  onSwipeDown?: (event: SwipeEventData) => void;
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

interface SwipePlayer {
  currentTrack: PlayerItem;
  currentTrackPosition?: number;
  skipNext?: () => void;
  skipPrev?: () => void;
  skipPrevForce?: () => void;
}
interface SwipeLogger {
  logSwipeSkipNext(
    uri: string | undefined,
    positionMs: number,
    durationMs: number,
  ): void;
  logSwipeSkipPrevious(
    uri: string | undefined,
    positionMs: number,
    durationMs: number,
  ): void;
}
