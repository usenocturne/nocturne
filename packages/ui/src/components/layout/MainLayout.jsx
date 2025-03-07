import React, { useState, useEffect, useRef } from "react";
import Sidebar from "../common/navigation/Sidebar";
import { useGradientState } from "../../hooks/useGradientState";
import {
  RecentsView,
  LibraryView,
  ArtistsView,
  RadioView,
  SettingsView,
  NowPlayingView,
} from "../views";

const MainLayout = ({ accessToken }) => {
  const [activeSection, setActiveSection] = useState(() => {
    return localStorage.getItem("lastActiveSection") || "recents";
  });

  const {
    currentColor1,
    currentColor2,
    currentColor3,
    currentColor4,
    generateMeshGradient,
    updateGradientColors,
  } = useGradientState();

  useEffect(() => {
    localStorage.setItem("lastActiveSection", activeSection);

    switch (activeSection) {
      case "nowPlaying":
        updateGradientColors(null, "nowPlaying");
        break;
      case "recents":
        updateGradientColors(null, "recents");
        break;
      case "library":
        updateGradientColors(null, "library");
        break;
      case "artists":
        updateGradientColors(null, "artists");
        break;
      case "radio":
        updateGradientColors(null, "radio");
        break;
      case "settings":
        updateGradientColors(null, "settings");
        break;
      default:
        updateGradientColors(null);
    }
  }, [activeSection, updateGradientColors]);

  const renderActiveView = () => {
    switch (activeSection) {
      case "nowPlaying":
        return <NowPlayingView accessToken={accessToken} />;
      case "recents":
        return <RecentsView accessToken={accessToken} />;
      case "library":
        return <LibraryView accessToken={accessToken} />;
      case "artists":
        return <ArtistsView accessToken={accessToken} />;
      case "radio":
        return <RadioView accessToken={accessToken} />;
      case "settings":
        return <SettingsView accessToken={accessToken} />;
      default:
        return <RecentsView accessToken={accessToken} />;
    }
  };

  return (
    <div className="h-screen overflow-hidden">
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

      <div className="relative z-10 h-full grid grid-cols-[2.2fr_3fr] fadeIn-animation">
        <div className="h-screen overflow-y-auto pb-12 pl-8 relative scroll-container scroll-smooth">
          <Sidebar
            activeSection={activeSection}
            setActiveSection={setActiveSection}
          />
        </div>

        <div className="h-screen overflow-y-auto">{renderActiveView()}</div>
      </div>
    </div>
  );
};

export default MainLayout;
