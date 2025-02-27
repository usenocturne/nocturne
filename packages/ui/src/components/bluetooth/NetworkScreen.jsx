import React, { useState, useEffect, useRef } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  BluetoothIcon,
  WifiMaxIcon,
} from "../icons";
import { useGradientState } from "../../hooks/useGradientState";
import { NocturneIcon } from "../icons";
import WiFiNetworks from "../settings/Network/WiFiNetworks";
import BluetoothDevices from "../settings/Network/BluetoothDevices";

const NetworkScreen = ({ isCheckingNetwork }) => {
  const [showMain, setShowMain] = useState(true);
  const [showNetwork, setShowNetwork] = useState(false);
  const [showSubpage, setShowSubpage] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [activeSubItem, setActiveSubItem] = useState(null);
  const [mainClasses, setMainClasses] = useState("translate-x-0 opacity-100");
  const [networkClasses, setNetworkClasses] = useState(
    "translate-x-full opacity-0"
  );
  const [subpageClasses, setSubpageClasses] = useState(
    "translate-x-full opacity-0"
  );
  const animationDuration = 450;

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

    const easeInOutQuad = (t) => {
      return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    };

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

  const openNetworkSettings = () => {
    if (isAnimating) return;
    setIsAnimating(true);
    setMainClasses("-translate-x-full opacity-0");
    setNetworkClasses("translate-x-0 opacity-100");
    setTimeout(() => {
      setShowMain(false);
      setShowNetwork(true);
      setIsAnimating(false);
    }, animationDuration);
  };

  const openSubpage = (option) => {
    if (isAnimating) return;
    setIsAnimating(true);
    setActiveSubItem(option);
    setNetworkClasses("-translate-x-full opacity-0");
    setSubpageClasses("translate-x-0 opacity-100");
    setTimeout(() => {
      setShowNetwork(false);
      setShowSubpage(true);
      setIsAnimating(false);
    }, animationDuration);
  };

  const navigateBack = () => {
    if (isAnimating) return;
    setIsAnimating(true);

    if (showSubpage) {
      setSubpageClasses("translate-x-full opacity-0");
      setNetworkClasses("translate-x-0 opacity-100");
      setTimeout(() => {
        setShowSubpage(false);
        setShowNetwork(true);
        setIsAnimating(false);
      }, animationDuration);
    } else if (showNetwork) {
      setNetworkClasses("translate-x-full opacity-0");
      setMainClasses("translate-x-0 opacity-100");
      setTimeout(() => {
        setShowNetwork(false);
        setShowMain(true);
        setIsAnimating(false);
      }, animationDuration);
    }
  };

  const networkOptions = [
    {
      id: "wifi",
      title: "Wi-Fi",
      icon: WifiMaxIcon,
      component: WiFiNetworks,
    },
    {
      id: "bluetooth",
      title: "Bluetooth",
      icon: BluetoothIcon,
      component: BluetoothDevices,
    },
  ];

  const renderSubpage = () => {
    if (!activeSubItem) return null;
    const Component = activeSubItem.component;
    return <Component />;
  };

  return (
    <div className="h-screen flex items-center justify-center overflow-hidden fixed inset-0 rounded-2xl">
      <style jsx>{`
        .screen-transition {
          transition: transform ${animationDuration}ms
              cubic-bezier(0.4, 0, 0.2, 1),
            opacity ${animationDuration}ms cubic-bezier(0.4, 0, 0.2, 1);
        }
      `}</style>
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
        className="absolute inset-0"
      />

      <div className="relative z-10 w-full h-full">
        <div className="relative w-full h-full settings-scroll-container overflow-hidden">
          <div
            className={`absolute top-0 left-0 w-full h-full screen-transition ${mainClasses}`}
          >
            <div className="w-full max-w-6xl px-6 mx-auto h-full flex items-center">
              <div className="grid grid-cols-2 gap-16 items-center w-full">
                <div className="flex flex-col items-start space-y-8 ml-12">
                  <NocturneIcon className="h-12 w-auto" />

                  <div className="space-y-4">
                    <h2 className="text-5xl text-white tracking-tight font-[580] w-[24rem]">
                      Connection Lost
                    </h2>
                    <p className="text-[28px] text-white/60 tracking-tight w-[32rem]">
                      Connect to "Nocturne" in your phone's Bluetooth settings.
                    </p>

                    <button
                      onClick={openNetworkSettings}
                      className="mt-4 bg-white/10 hover:bg-white/20 border border-white/10 transition-colors duration-200 rounded-xl px-6 py-3"
                      disabled={isAnimating}
                    >
                      <span className="text-[28px] font-[560] text-white tracking-tight">
                        Network Settings
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            className={`absolute top-0 left-0 w-full h-full screen-transition ${networkClasses}`}
          >
            <div className="p-12 h-full overflow-y-auto">
              <div className="flex items-center mb-6">
                <button
                  onClick={navigateBack}
                  className="mr-4"
                  disabled={isAnimating}
                >
                  <ChevronLeftIcon className="w-8 h-8 text-white" />
                </button>
                <h2 className="text-[46px] font-[580] text-white tracking-tight">
                  Network
                </h2>
              </div>

              <div className="space-y-4">
                {networkOptions.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => openSubpage(option)}
                    className="flex items-center justify-between w-full p-4 bg-white/10 rounded-xl hover:bg-white/20 transition-colors border border-white/10"
                    disabled={isAnimating}
                  >
                    <div className="flex items-center">
                      <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center">
                        <option.icon className="w-7 h-7 text-white" />
                      </div>
                      <span className="text-[32px] ml-4 font-[580] text-white tracking-tight">
                        {option.title}
                      </span>
                    </div>
                    <ChevronRightIcon className="w-8 h-8 text-white/60" />
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div
            className={`absolute top-0 left-0 w-full h-full screen-transition ${subpageClasses}`}
          >
            <div className="p-12 h-full overflow-y-auto">
              <div className="flex items-center mb-6">
                <button
                  onClick={navigateBack}
                  className="mr-4"
                  disabled={isAnimating}
                >
                  <ChevronLeftIcon className="w-8 h-8 text-white" />
                </button>
                <h2 className="text-[46px] font-[580] text-white tracking-tight">
                  {activeSubItem?.title}
                </h2>
              </div>

              <div className="space-y-6">{renderSubpage()}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NetworkScreen;
