import { autorun, runInAction } from "mobx";
import { useEffect, useRef } from "react";
import { easingFunction, transitionDurationMs } from "../styles/Variables";

let dragging = false;

const setDragging = (value) => (dragging = value);

export const useSwiperDial = (args) => {
  const swiperRef = useRef();
  useEffect(() => {
    const setAnimate = (isAnimated) => {
      if (args.setAnimateSliding) {
        args.setAnimateSliding(isAnimated);
      }
    };
    runInAction(() => setAnimate(false));
    const disposer = autorun(() => {
      if (
        args.selectedItemIndex !== undefined &&
        args.selectedItemIndex > -1 &&
        !dragging
      ) {
        if (swiperRef.current) {
          swiperRef.current.slideTo(
            args.selectedItemIndex,
            args.animateSliding ? transitionDurationMs : 0,
          );
          swiperRef.current.wrapperEl.style.transitionTimingFunction =
            easingFunction;
        }
        setAnimate(true);
      }
    });

    return () => {
      disposer();
    };
  }, [args]);

  return { setDragging, swiperRef };
};
