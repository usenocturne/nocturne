import { memo } from "react";

const VolumeOverlay = ({
  visible,
  animation,
  displayVolume,
  suppressFillTransition,
  volumeIcon,
}) => {
  const className = !visible
    ? "fixed top-[4.5rem] pointer-events-none hidden"
    : animation === "showing"
      ? "fixed top-[4.5rem] pointer-events-none volumeInScale"
      : animation === "hiding"
        ? "fixed top-[4.5rem] pointer-events-none volumeOutScale"
        : "fixed top-[4.5rem] pointer-events-none hidden";

  const clampedVolume = Math.max(0, Math.min(displayVolume ?? 0, 100));
  const targetScaleY = clampedVolume / 100;

  return (
    <div
      className={className}
      style={{
        right: "54px",
        zIndex: 50,
      }}
    >
      <div className="relative w-14 h-44 bg-slate-700/60 rounded-[17px] volume-shell overflow-hidden">
        <div
          className="volume-fill"
          style={{
            transform: `translate3d(0, 0, 0) scaleY(${targetScaleY})`,
            transition: suppressFillTransition
              ? "none"
              : "transform 50ms linear",
          }}
        />
        <div className="absolute bottom-0 left-0 right-0 flex justify-center items-center h-6 pb-7">
          {volumeIcon}
        </div>
      </div>
    </div>
  );
};

export default memo(VolumeOverlay);
