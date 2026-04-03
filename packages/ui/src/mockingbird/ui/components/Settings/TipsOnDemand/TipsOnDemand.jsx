import styles from "./TipsOnDemand.module.scss";
import { observer } from "mobx-react-lite";
import { useState, useRef, useEffect } from "react";
import classNames from "classnames";
import pointerListenersMaker from "../../../helpers/PointerListeners";
import { useCarThingStore } from "../../../contexts/CarThingStore";

const TIPS = [
  {
    title: "Swipe to skip",
    description:
      "Swipe left or right on the Now Playing screen to skip to the next or previous track.",
  },
  {
    title: "Save a preset",
    description:
      "Long press a preset button to save what's currently playing for quick access later.",
  },
  {
    title: "Check your queue",
    description:
      "Tap the playlist or album name at the top of the Now Playing screen to see what's coming up next.",
  },
  {
    title: "Adjust the volume",
    description:
      "Turn the dial left or right on the Now Playing screen to adjust volume.",
  },
  {
    title: "Browse your library",
    description:
      "Press the back button to return to the shelf where you can browse playlists, artists, and albums.",
  },
  {
    title: "Scrub through a track",
    description:
      "Tap the progress bar on the Now Playing screen, then turn the dial to scrub forward or back.",
  },
  {
    title: "Shuffle and repeat",
    description:
      "Use the shuffle and repeat buttons on the Now Playing screen to change playback mode.",
  },
  {
    title: "See more items",
    description:
      "When browsing the shelf, scroll past the visible items and tap More to see additional content.",
  },
  {
    title: "Quick restart",
    description:
      "Go to Settings, then Power and Reset to restart your Car Thing or perform a factory reset.",
  },
];

const TipsOnDemandError = ({ onConfirm }) => {
  const [pressed, setPressed] = useState(false);

  return (
    <div className={styles.error}>
      <div className={styles.errorTitle}>Can't get tips right now</div>
      <div className={styles.errorDescription}>
        You might have lost the connection to your phone or network. Try again
        in a little while.
      </div>
      <div
        className={classNames(styles.okButton, { [styles.pressed]: pressed })}
        {...pointerListenersMaker(setPressed)}
        onClick={onConfirm}
      >
        OK
      </div>
    </div>
  );
};

const TipsOnDemand = () => {
  const { settingsStore } = useCarThingStore();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [pressed, setPressed] = useState(false);
  const [isError, setIsError] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [tipState, setTipState] = useState("visible");
  const tipRef = useRef(null);

  const tip = TIPS[currentIndex];

  const nextTip = () => {
    if (transitioning) return;
    setTransitioning(true);
    setTipState("exiting");

    setTimeout(() => {
      setCurrentIndex((prev) => (prev + 1) % TIPS.length);
      setTipState("entering");

      setTimeout(() => {
        setTipState("visible");
        setTransitioning(false);
      }, 300);
    }, 300);
  };

  const handleConfirmError = () => {
    settingsStore.handleBack();
  };

  return (
    <div className={styles.background}>
      {isError ? (
        <TipsOnDemandError onConfirm={handleConfirmError} />
      ) : (
        <div className={styles.tipsOnDemand}>
          <div>
            <div
              ref={tipRef}
              className={classNames(styles.tipContent, {
                [styles.tipOnDemandEnter]: tipState === "entering",
                [styles.tipOnDemandEnterActive]: tipState === "entering",
                [styles.tipOnDemandExit]: tipState === "exiting",
                [styles.tipOnDemandExitActive]: tipState === "exiting",
              })}
            >
              <div className={styles.tipTitle}>{tip.title}</div>
              <div className={styles.tipDescription}>{tip.description}</div>
            </div>
          </div>
          <div className={styles.buttonContainer} onPointerDown={nextTip}>
            <div
              className={classNames(styles.nextButton, {
                [styles.pressed]: pressed,
              })}
              {...pointerListenersMaker(setPressed)}
            >
              <span>Next</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default observer(TipsOnDemand);
