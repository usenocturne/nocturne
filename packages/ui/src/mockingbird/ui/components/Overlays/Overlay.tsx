import type { CSSProperties, ReactNode } from "react";
import type { TransitionStatus } from "react-transition-group/Transition";
import { useRef } from "react";
import { Transition } from "react-transition-group";
import {
  ENTERED,
  ENTERING,
  EXITED,
  EXITING,
} from "react-transition-group/Transition";
import classnames from "classnames";
import {
  transitionDurationMs,
  genericEasing,
  recedeDefaultEasing,
} from "../../styles/Variables";
import styles from "./Overlays.module.scss";

export const FROM = {
  TOP: "top",
  BOTTOM: "bottom",
  FADE_IN: "fade_in",
} as const;

export const OVERLAY_TRANSITION_DURATION_MS = 300;

const getFromTopStyles = (
  outDelay: number,
): Partial<Record<TransitionStatus, CSSProperties>> => ({
  [ENTERING]: { transform: "translateY(0px)" },
  [ENTERED]: { transform: "translateY(0px)" },
  [EXITING]: {
    transform: "translateY(-480px)",
    transitionDelay: `${outDelay}ms`,
  },
  [EXITED]: { transform: "translateY(-480px)" },
});

const getBottomUpStyles = (
  outDelay: number,
): Partial<Record<TransitionStatus, CSSProperties>> => ({
  [ENTERING]: { transform: "translateY(0px)" },
  [ENTERED]: { transform: "translateY(0px)" },
  [EXITING]: {
    transform: "translateY(480px)",
    transitionDelay: `${outDelay}ms`,
  },
  [EXITED]: { transform: "translateY(480px)" },
});

const getFadeInStyles = (
  outDelay: number,
): Partial<Record<TransitionStatus, CSSProperties>> => ({
  [ENTERING]: {
    opacity: 1,
    transitionTimingFunction: genericEasing,
    transitionDuration: `${OVERLAY_TRANSITION_DURATION_MS}ms`,
  },
  [ENTERED]: { opacity: 1 },
  [EXITING]: {
    opacity: 0,
    transitionDelay: `${outDelay}ms`,
    transitionTimingFunction: recedeDefaultEasing,
    transitionDuration: `${OVERLAY_TRANSITION_DURATION_MS}ms`,
  },
  [EXITED]: { opacity: 0 },
});

const appearanceClasses = {
  [FROM.TOP]: getFromTopStyles,
  [FROM.BOTTOM]: getBottomUpStyles,
  [FROM.FADE_IN]: getFadeInStyles,
};

const reflow = (node: HTMLElement | null) => {
  node?.scrollTop;
};

const Overlay = ({
  children,
  show,
  appear = FROM.FADE_IN,
  classname,
  outDelay = 0,
}: {
  children?: ReactNode;
  show?: boolean;
  appear?: (typeof FROM)[keyof typeof FROM];
  classname?: string;
  outDelay?: number;
}) => {
  const nodeRef = useRef<HTMLDivElement>(null);
  const getAnimationStyle = (state: TransitionStatus) =>
    appearanceClasses[appear](outDelay)[state];
  return (
    <Transition
      nodeRef={nodeRef}
      unmountOnExit
      mountOnEnter
      onEnter={() => reflow(nodeRef.current)}
      timeout={{
        enter: transitionDurationMs,
        exit: transitionDurationMs + outDelay,
      }}
      in={show}
    >
      {(state) => (
        <div
          ref={nodeRef}
          className={classnames(styles.overlay, classname)}
          style={getAnimationStyle(state)}
        >
          {children}
        </div>
      )}
    </Transition>
  );
};

export default Overlay;
