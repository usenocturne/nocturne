import React, { memo } from "react";
import {
  NowPlayingIcon,
  RecentsIcon,
  LibraryIcon,
  ArtistsIcon,
  RadioIcon,
  PodcastIcon,
  SettingsIcon,
} from "../../common/icons";
import StatusBar from "./StatusBar";
import { useSettings } from "../../../contexts/SettingsContext";

const SidebarItem = memo(
  ({ section, icon: Icon, label, isActive, onSelect }) => (
    <div
      className="relative flex items-center group"
      onClick={() => onSelect(section)}
    >
      {isActive && (
        <div
          className="absolute left-[-19px] top-1/2 transform -translate-y-1/2 h-8 w-1.5 bg-white rounded-full drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)]"
          aria-hidden="true"
        />
      )}
      <div className="mr-4 flex-shrink-0">
        <div className="h-[70px] w-[70px] bg-white/25 rounded-[12px] flex items-center justify-center border border-white/10 drop-shadow-[0_20px_5px_rgba(0,0,0,0.25)]">
          <Icon className="h-10 w-10 text-white" />
        </div>
      </div>
      <div>
        <h4 className="ml-1 text-[32px] font-[580] text-white tracking-tight">
          {label}
        </h4>
      </div>
    </div>
  ),
  (prev, next) => prev.isActive === next.isActive,
);

const SidebarComponent = function Sidebar({ activeSection, setActiveSection }) {
  const { settings } = useSettings();

  const handleSectionClick = (section) => {
    setActiveSection(section);
  };

  return (
    <div className="space-y-7 pt-12">
      {settings.showStatusBar && <StatusBar />}

      <SidebarItem
        section="nowPlaying"
        icon={NowPlayingIcon}
        label="Now Playing"
        isActive={activeSection === "nowPlaying"}
        onSelect={handleSectionClick}
      />
      <SidebarItem
        section="recents"
        icon={RecentsIcon}
        label="Recents"
        isActive={activeSection === "recents"}
        onSelect={handleSectionClick}
      />
      <SidebarItem
        section="library"
        icon={LibraryIcon}
        label="Library"
        isActive={activeSection === "library"}
        onSelect={handleSectionClick}
      />
      <SidebarItem
        section="artists"
        icon={ArtistsIcon}
        label="Artists"
        isActive={activeSection === "artists"}
        onSelect={handleSectionClick}
      />
      <SidebarItem
        section="radio"
        icon={RadioIcon}
        label="Radio"
        isActive={activeSection === "radio"}
        onSelect={handleSectionClick}
      />
      <SidebarItem
        section="podcasts"
        icon={PodcastIcon}
        label="Podcasts"
        isActive={activeSection === "podcasts"}
        onSelect={handleSectionClick}
      />
      <SidebarItem
        section="settings"
        icon={SettingsIcon}
        label="Settings"
        isActive={activeSection === "settings"}
        onSelect={handleSectionClick}
      />
    </div>
  );
};

export default memo(
  SidebarComponent,
  (prev, next) =>
    prev.activeSection === next.activeSection &&
    prev.setActiveSection === next.setActiveSection,
);
