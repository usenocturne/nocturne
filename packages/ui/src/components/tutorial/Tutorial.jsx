import React, { useState, useEffect } from "react";
import TutorialFrame from "../../../public/graphics/tutorial/TutorialFrame";
import { NocturneIcon } from "../../components/icons";
import { useGradientState } from "../../hooks/useGradientState";

const Tutorial = ({ onComplete }) => {
  const [currentScreen, setCurrentScreen] = useState(0);
  const [isTextVisible, setIsTextVisible] = useState(true);
  const [isFrameVisible, setIsFrameVisible] = useState(false);
  const {
    currentColor1,
    currentColor2,
    currentColor3,
    currentColor4,
    generateMeshGradient,
    setTargetColor1,
    setTargetColor2,
    setTargetColor3,
    setTargetColor4,
  } = useGradientState();

  useEffect(() => {
    if (currentScreen === 1) {
      setTimeout(() => setIsFrameVisible(true), 50);
    } else if (currentScreen === screens.length - 1) {
      setIsFrameVisible(false);
    }
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
        "Turn the dial to scroll through your music. Try it now - scroll right to continue.",
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
      subtext: (
        <>
          Hold any preset button while viewing a playlist to map it.
          <br />
          Try it now.
        </>
      ),
      continueType: "hold1",
    },
    {
      header: "Presets",
      subtext: (
        <>
          Press a mapped button anytime to instantly start playback.
          <br />
          Try it now.
        </>
      ),
      continueType: "topButtonPress",
    },
    {
      header: "Controls",
      subtext:
        "Press the rightmost button to adjust brightness with the dial. Try it now.",
      continueType: "brightnessPress",
    },
    {
      header: "Controls",
      subtext:
        "While in the Now Playing tab, turn the dial to adjust volume. Scroll right to continue.",
      continueType: "scroll",
    },
    {
      header: "Mixes",
      subtext: "Personalized mixes are always fresh - check the Radio tab.",
      continueType: "button",
    },
    {
      header: "Gestures",
      subtext: "Swipe left/right in the Now Playing tab to skip tracks.",
      continueType: "button",
    },
    {
      header: "Good to Go!",
      subtext:
        "You're all set! Press 'Get Started' to begin exploring your music.",
      continueType: "button",
    },
  ];

  useEffect(() => {
    let holdTimer = null;
    const validPresetButtons = ["1", "2", "3", "4"];

    const handleWheel = (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (
        screens[currentScreen].continueType === "scroll" &&
        event.deltaX > 0
      ) {
        setIsTextVisible(false);
        setTimeout(() => {
          setCurrentScreen((prev) => prev + 1);
          setTimeout(() => {
            setIsTextVisible(true);
          }, 50);
        }, 200);
      }
    };

    const handleKeyDown = (e) => {
      if (
        screens[currentScreen].continueType === "backPress" &&
        e.key === "Escape"
      ) {
        setIsTextVisible(false);
        setTimeout(() => {
          setCurrentScreen((prev) => prev + 1);
          setTimeout(() => {
            setIsTextVisible(true);
          }, 50);
        }, 200);
      } else if (
        screens[currentScreen].continueType === "topButtonPress" &&
        validPresetButtons.includes(e.key)
      ) {
        setIsTextVisible(false);
        setTimeout(() => {
          setCurrentScreen((prev) => prev + 1);
          setTimeout(() => {
            setIsTextVisible(true);
          }, 50);
        }, 200);
      } else if (
        screens[currentScreen].continueType === "brightnessPress" &&
        e.key.toLowerCase() === "m"
      ) {
        setIsTextVisible(false);
        setTimeout(() => {
          setCurrentScreen((prev) => prev + 1);
          setTimeout(() => {
            setIsTextVisible(true);
          }, 50);
        }, 200);
      } else if (
        screens[currentScreen].continueType === "hold1" &&
        validPresetButtons.includes(e.key)
      ) {
        holdTimer = setTimeout(() => {
          setIsTextVisible(false);
          setTimeout(() => {
            setCurrentScreen((prev) => prev + 1);
            setTimeout(() => {
              setIsTextVisible(true);
            }, 50);
          }, 200);
        }, 800);
      }
    };

    const handleKeyUp = (e) => {
      if (validPresetButtons.includes(e.key) && holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
    };

    document.addEventListener("wheel", handleWheel, {
      passive: false,
      capture: true,
    });
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      document.removeEventListener("wheel", handleWheel, { capture: true });
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      if (holdTimer) {
        clearTimeout(holdTimer);
      }
    };
  }, [currentScreen]);

  const gradientThemes = [
    { colors: ["#2C1E3D", "#532E5D", "#8D5DA7", "#B98BC9"] },
    { colors: ["#1A1423", "#3D2C8D", "#9163CB", "#D499B9"] },
    { colors: ["#0D1B2A", "#1B263B", "#415A77", "#778DA9"] },
    { colors: ["#0B132B", "#1C2541", "#3A506B", "#5BC0BE"] },
    { colors: ["#241623", "#3C223F", "#5C2A6A", "#8E4585"] },
  ];

  useEffect(() => {
    let animationFrameId;
    let startTime = Date.now();
    const totalDuration = 30000;

    const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);

    const interpolateColor = (color1, color2, factor) => {
      const r1 = parseInt(color1.slice(1, 3), 16);
      const g1 = parseInt(color1.slice(3, 5), 16);
      const b1 = parseInt(color1.slice(5, 7), 16);

      const r2 = parseInt(color2.slice(1, 3), 16);
      const g2 = parseInt(color2.slice(3, 5), 16);
      const b2 = parseInt(color2.slice(5, 7), 16);

      const r = Math.round(r1 + (r2 - r1) * factor);
      const g = Math.round(g1 + (g2 - g1) * factor);
      const b = Math.round(b1 + (b2 - b1) * factor);

      return `#${r.toString(16).padStart(2, "0")}${g
        .toString(16)
        .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    };

    const animate = () => {
      const now = Date.now();
      const elapsed = (now - startTime) % totalDuration;
      const rawProgress = elapsed / totalDuration;

      const themeCount = gradientThemes.length;
      const themePosition = rawProgress * themeCount;
      const currentThemeIndex = Math.floor(themePosition);
      const nextThemeIndex = (currentThemeIndex + 1) % themeCount;

      let themeProgress = themePosition - currentThemeIndex;
      themeProgress = easeInOutQuad(themeProgress);

      const currentTheme = gradientThemes[currentThemeIndex];
      const nextTheme = gradientThemes[nextThemeIndex];

      if (elapsed % 12 === 0) {
        setTargetColor1(
          interpolateColor(
            currentTheme.colors[0],
            nextTheme.colors[0],
            themeProgress
          )
        );
        setTargetColor2(
          interpolateColor(
            currentTheme.colors[1],
            nextTheme.colors[1],
            themeProgress
          )
        );
        setTargetColor3(
          interpolateColor(
            currentTheme.colors[2],
            nextTheme.colors[2],
            themeProgress
          )
        );
        setTargetColor4(
          interpolateColor(
            currentTheme.colors[3],
            nextTheme.colors[3],
            themeProgress
          )
        );
      }

      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [setTargetColor1, setTargetColor2, setTargetColor3, setTargetColor4]);

  const handleContinue = () => {
    setIsTextVisible(false);

    setTimeout(() => {
      if (currentScreen === screens.length - 1) {
        onComplete();
      } else {
        setCurrentScreen((prev) => prev + 1);
        setTimeout(() => {
          setIsTextVisible(true);
        }, 50);
      }
    }, 200);
  };

  return (
    <div className="fixed inset-0 w-full h-full">
      <div
        style={{
          backgroundImage: generateMeshGradient([
            currentColor1,
            currentColor2,
            currentColor3,
            currentColor4,
          ]),
          transition: "background-image 0.5s linear",
        }}
        className="absolute inset-0 rounded-2xl"
      />

      <div className="relative h-full z-10 flex justify-between px-12">
        <div className="flex flex-col items-start w-1/2 mr-12 pt-[calc(50vh-140px)]">
          <NocturneIcon className="h-12 w-auto mb-8" />
          <div
            className={`space-y-4 transition-opacity duration-200 ${
              isTextVisible ? "opacity-100" : "opacity-0"
            }`}
            key={currentScreen}
          >
            <h2 className="text-5xl text-white tracking-tight font-[580] w-[29rem]">
              {screens[currentScreen].header}
            </h2>
            <p
              className={`text-[28px] text-white/60 tracking-tight ${
                currentScreen === screens.length - 1 ? "w-[30rem]" : "w-[24rem]"
              }`}
            >
              {screens[currentScreen].subtext}
            </p>
            {screens[currentScreen].continueType === "button" && (
              <button
                onClick={handleContinue}
                className="mt-4 bg-white/10 hover:bg-white/20 transition-colors duration-200 rounded-xl px-6 py-3"
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

        {currentScreen !== 0 && currentScreen !== screens.length - 1 && (
          <div className="flex items-center justify-center w-1/2">
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
