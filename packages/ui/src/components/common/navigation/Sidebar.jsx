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

export default function Sidebar({ activeSection, setActiveSection }) {
  const { settings } = useSettings();

  const handleSectionClick = (section) => {
    setActiveSection(section);
  };

  const SidebarItem = ({ section, icon: Icon, label }) => (
    <div
      className="relative flex items-center group"
      onClick={() => handleSectionClick(section)}
    >
      {activeSection === section && (
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
  );

  return (
    <div className="space-y-7 pt-12">
      {settings.showStatusBar && <StatusBar />}

      <SidebarItem
        section="nowPlaying"
        icon={NowPlayingIcon}
        label="Now Playing"
      />
      <SidebarItem section="recents" icon={RecentsIcon} label="Recents" />
      <SidebarItem section="library" icon={LibraryIcon} label="Library" />
      <SidebarItem section="artists" icon={ArtistsIcon} label="Artists" />
      <SidebarItem section="radio" icon={RadioIcon} label="Radio" />
      <SidebarItem section="podcasts" icon={PodcastIcon} label="Podcasts" />
      <SidebarItem section="settings" icon={SettingsIcon} label="Settings" />
    </div>
  );
}
