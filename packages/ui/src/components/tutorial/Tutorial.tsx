import React, { useState, useEffect, useRef, useCallback } from "react";
import TutorialFrame from "./TutorialFrame";
import NocturneIcon from "../common/icons/NocturneIcon";
import { useNavigation } from "../../hooks/useNavigation";

const TUTORIAL_HOLD_MS = 800;

const Tutorial = ({ onComplete, onStepChange }: UiComponentProps) => {
  const [currentScreen, setCurrentScreen] = useState(0);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [isContentVisible, setIsContentVisible] = useState(true);
  const [isFrameVisible, setIsFrameVisible] = useState(false);
  const tutorialContainerRef = useRef(null);
  const holdTimerRef = useRef(null);
  const skipComboTimerRef = useRef(null);
  const skipComboArmedRef = useRef(false);
  const skipComboKeysRef = useRef({ escape: false, four: false });
  const onCompleteRef = useRef(onComplete);
  const isHoldingButton = useRef(false);
  const buttonLockRef = useRef(false);
  const lastPressedKey = useRef(null);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (currentScreen === 1) {
      setTimeout(() => setIsFrameVisible(true), 50);
    } else if (currentScreen === screens.length - 1) {
      setIsFrameVisible(false);
    }

    if (onStepChange) {
      onStepChange(currentScreen);
    }

    buttonLockRef.current = true;
    setTimeout(() => {
      buttonLockRef.current = false;
      isHoldingButton.current = false;
      lastPressedKey.current = null;
    }, 500);
  }, [currentScreen]);

  const screens = [
    {
      header: "Welcome to Nocturne",
      subtext: "Your Car Thing's next chapter. Let's explore the basics.",
      continueType: "button",
    },
    {
      header: "Navigation",
      subtext:
        "Turn the dial to browse your music. Try it now - scroll right to continue.",
      continueType: "scroll",
    },
    {
      header: "Navigation",
      subtext:
        "Press the back button to return to previous screens. Try it now.",
      continueType: "backPress",
    },
    {
      header: "Presets",
      subtext:
        "Hold any preset button while viewing a playlist to map it. Try it now.",
      continueType: "hold1",
    },
    {
      header: "Presets",
      subtext:
        "Press a mapped button anytime to instantly start playback. Try it now.",
      continueType: "topButtonPress",
    },
    {
      header: "Controls",
      subtext:
        "Turn the dial in the Now Playing tab to adjust volume. Scroll right to continue.",
      continueType: "scroll",
    },
    {
      header: "Controls",
      subtext: "Press the rightmost button to lock the screen. Try it now.",
      continueType: "lockPress",
    },
    {
      header: "Controls",
      subtext:
        "Hold the rightmost button to access quick settings. Try it now.",
      continueType: "holdPower",
    },
    {
      header: "Playback",
      subtext:
        "Tap the progress bar to scrub tracks. Turn the dial, and press to confirm.",
      continueType: "button",
    },
    {
      header: "Mixes",
      subtext: "The Radio tab knows what you'll love next.",
      continueType: "button",
    },
    {
      header: "Gestures",
      subtext: "Swipe left/right in the Now Playing tab to skip tracks.",
      continueType: "button",
    },
    {
      header: "Voice",
      subtext: 'Say "Hey Nocturne", then speak to control your music. ',
      continueType: "button",
    },
    {
      header: "Good to Go!",
      subtext:
        "You're all set! Press 'Get Started' to begin exploring your music.",
      continueType: "button",
    },
  ];

  const completeTutorial = useCallback(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("hasSeenTutorial", "true");
    }
    onCompleteRef.current();
  }, []);

  const handleScreenTransition = (nextScreen) => {
    const currentHeader = screens[currentScreen].header;
    const nextHeader = screens[nextScreen].header;
    const headerChanging = currentHeader !== nextHeader;

    if (headerChanging) {
      setIsHeaderVisible(false);
    }
    setIsContentVisible(false);

    setTimeout(() => {
      setCurrentScreen(nextScreen);
      setTimeout(() => {
        if (headerChanging) {
          setIsHeaderVisible(true);
        }
        setIsContentVisible(true);
      }, 50);
    }, 200);
  };

  useNavigation({
    containerRef: tutorialContainerRef,
    activeSection: "tutorial",
    enableWheelNavigation: true,
    enableKeyboardNavigation: true,
    enableItemSelection: false,
    enableScrollTracking: false,
    enableEscapeKey: true,
    onEscape: () => {
      if (screens[currentScreen].continueType === "backPress") {
        handleScreenTransition(currentScreen + 1);
      }
    },
  });

  useEffect(() => {
    const validPresetButtons = ["1", "2", "3", "4"];
    const isEscapeKey = (key) => key === "Escape" || key === "Esc";

    const clearHoldTimer = () => {
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
    };

    const clearSkipComboTimer = () => {
      if (skipComboTimerRef.current) {
        clearTimeout(skipComboTimerRef.current);
        skipComboTimerRef.current = null;
      }
    };

    const cancelSkipCombo = () => {
      clearSkipComboTimer();
      skipComboArmedRef.current = false;
      skipComboKeysRef.current = { escape: false, four: false };
    };

    const suppressShortcutEvent = (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };

    const updateSkipCombo = (event, isPressed) => {
      if (isEscapeKey(event.key)) {
        skipComboKeysRef.current.escape = isPressed;
      } else if (event.key === "4") {
        skipComboKeysRef.current.four = isPressed;
      } else {
        return false;
      }

      const skipComboActive =
        skipComboKeysRef.current.escape && skipComboKeysRef.current.four;

      if (skipComboArmedRef.current) {
        suppressShortcutEvent(event);

        if (
          !skipComboKeysRef.current.escape &&
          !skipComboKeysRef.current.four
        ) {
          skipComboArmedRef.current = false;
          completeTutorial();
        }

        return true;
      }

      if (!skipComboActive) {
        if (!isPressed) {
          clearSkipComboTimer();
        }
        return false;
      }

      suppressShortcutEvent(event);
      clearHoldTimer();
      isHoldingButton.current = false;
      lastPressedKey.current = null;

      if (!skipComboTimerRef.current) {
        skipComboTimerRef.current = setTimeout(() => {
          skipComboTimerRef.current = null;
          skipComboArmedRef.current = true;
        }, TUTORIAL_HOLD_MS);
      }

      return true;
    };

    const onKeyDown = (e) => {
      if (updateSkipCombo(e, true)) return;

      if (buttonLockRef.current) return;

      if (
        screens[currentScreen].continueType === "backPress" &&
        isEscapeKey(e.key)
      ) {
        e.preventDefault();
        e.stopPropagation();
        handleScreenTransition(currentScreen + 1);
        return;
      }

      if (
        screens[currentScreen].continueType === "topButtonPress" &&
        validPresetButtons.includes(e.key) &&
        lastPressedKey.current !== e.key
      ) {
        lastPressedKey.current = e.key;
        handleScreenTransition(currentScreen + 1);
        return;
      }

      if (
        screens[currentScreen].continueType === "lockPress" &&
        e.key.toLowerCase() === "m"
      ) {
        handleScreenTransition(currentScreen + 1);
        return;
      }

      if (
        screens[currentScreen].continueType === "hold1" &&
        validPresetButtons.includes(e.key)
      ) {
        if (isHoldingButton.current && lastPressedKey.current === e.key) return;

        isHoldingButton.current = true;
        lastPressedKey.current = e.key;

        if (holdTimerRef.current) {
          clearTimeout(holdTimerRef.current);
        }

        holdTimerRef.current = setTimeout(() => {
          handleScreenTransition(currentScreen + 1);
          holdTimerRef.current = null;
        }, TUTORIAL_HOLD_MS);
      }

      if (
        screens[currentScreen].continueType === "holdPower" &&
        e.key.toLowerCase() === "m"
      ) {
        if (isHoldingButton.current && lastPressedKey.current === "m") return;

        isHoldingButton.current = true;
        lastPressedKey.current = "m";

        if (holdTimerRef.current) {
          clearTimeout(holdTimerRef.current);
        }

        holdTimerRef.current = setTimeout(() => {
          handleScreenTransition(currentScreen + 1);
          holdTimerRef.current = null;
        }, TUTORIAL_HOLD_MS);
      }
    };

    const onKeyUp = (e) => {
      const validPresetButtons = ["1", "2", "3", "4"];
      const skipComboWasActive =
        skipComboTimerRef.current !== null ||
        skipComboArmedRef.current ||
        (skipComboKeysRef.current.escape && skipComboKeysRef.current.four);

      if (isEscapeKey(e.key) || e.key === "4") {
        updateSkipCombo(e, false);

        if (skipComboWasActive) {
          suppressShortcutEvent(e);
          return;
        }
      }

      if (
        validPresetButtons.includes(e.key) &&
        lastPressedKey.current === e.key
      ) {
        isHoldingButton.current = false;

        if (holdTimerRef.current) {
          clearTimeout(holdTimerRef.current);
          holdTimerRef.current = null;
        }

        if (!buttonLockRef.current) {
          lastPressedKey.current = null;
        }
      }

      if (e.key.toLowerCase() === "m" && lastPressedKey.current === "m") {
        isHoldingButton.current = false;

        if (holdTimerRef.current) {
          clearTimeout(holdTimerRef.current);
          holdTimerRef.current = null;
        }

        if (!buttonLockRef.current) {
          lastPressedKey.current = null;
        }
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });

    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("keyup", onKeyUp, { capture: true });

      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      cancelSkipCombo();
    };
  }, [completeTutorial, currentScreen]);

  useEffect(() => {
    const handleWheel = (event) => {
      if (
        screens[currentScreen].continueType === "scroll" &&
        event.deltaX > 0
      ) {
        event.preventDefault();
        event.stopPropagation();
        handleScreenTransition(currentScreen + 1);
      }
    };

    document.addEventListener("wheel", handleWheel, {
      passive: false,
      capture: true,
    });

    return () => {
      document.removeEventListener("wheel", handleWheel, { capture: true });
    };
  }, [currentScreen]);

  const handleContinue = () => {
    if (currentScreen === screens.length - 1) {
      completeTutorial();
    } else {
      handleScreenTransition(currentScreen + 1);
    }
  };

  return (
    <div className="fixed inset-0 w-full h-full" ref={tutorialContainerRef}>
      <div className="relative h-full z-10 flex justify-between px-6">
        <div className="flex flex-col items-start w-1/2 -mr-6 ml-12 flex-1 justify-center">
          <NocturneIcon className="h-12 w-auto mb-8" />
          <div className="h-[220px]" key={currentScreen}>
            <div
              className={`transition-opacity duration-200 ${
                isHeaderVisible ? "opacity-100" : "opacity-0"
              }`}
            >
              <h2 className="text-5xl text-white tracking-tight font-[580] w-[29rem]">
                {screens[currentScreen].header}
              </h2>
            </div>
            <div
              className={`space-y-4 transition-opacity duration-200 ${
                isContentVisible ? "opacity-100" : "opacity-0"
              }`}
            >
              <p
                className={`text-[28px] mt-3 text-white/60 tracking-tight ${
                  currentScreen === 0 || currentScreen === screens.length - 1
                    ? "w-[30rem]"
                    : "w-[20.68rem]"
                }`}
              >
                {screens[currentScreen].subtext}
              </p>
              {screens[currentScreen].continueType === "button" && (
                <button
                  onClick={handleContinue}
                  className="mt-4 bg-white/10 hover:bg-white/20 focus:outline-none transition-colors duration-200 rounded-xl px-6 py-3"
                >
                  <span className="text-[28px] font-[560] text-white tracking-tight">
                    {currentScreen === screens.length - 1
                      ? "Get Started"
                      : "Continue"}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>

        {currentScreen !== 0 && currentScreen !== screens.length - 1 && (
          <div className="flex items-center justify-center">
            <div
              className={`transition-opacity duration-500 ${
                isFrameVisible ? "opacity-100" : "opacity-0"
              }`}
            >
              <TutorialFrame currentScreen={currentScreen} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Tutorial;
